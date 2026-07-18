import asyncio
import logging
import time
from urllib.parse import urlparse


logger = logging.getLogger(__name__)


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._counts: dict[str, tuple[int, int]] = {}
        self._lock = asyncio.Lock()

    async def increment(self, key: str, window_seconds: int) -> int:
        window = int(time.time()) // window_seconds
        async with self._lock:
            previous_window, count = self._counts.get(key, (window, 0))
            count = count + 1 if previous_window == window else 1
            self._counts[key] = (window, count)
            return count


class RedisRateLimiter:
    """Minimal RESP client for one atomic fixed-window counter operation."""

    _SCRIPT = (
        "local n=redis.call('INCR',KEYS[1]); "
        "if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n"
    )

    def __init__(self, redis_url: str) -> None:
        parsed = urlparse(redis_url)
        if parsed.scheme not in {"redis", "rediss"} or parsed.hostname is None:
            raise ValueError("REDIS_URL must be a redis:// or rediss:// URL")
        self._host = parsed.hostname
        self._port = parsed.port or 6379
        self._password = parsed.password
        self._database = int(parsed.path.removeprefix("/") or "0")
        self._ssl = parsed.scheme == "rediss"

    @staticmethod
    def _command(*parts: str) -> bytes:
        encoded = [part.encode() for part in parts]
        return b"*%d\r\n" % len(encoded) + b"".join(
            b"$%d\r\n" % len(part) + part + b"\r\n" for part in encoded
        )

    async def increment(self, key: str, window_seconds: int) -> int:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(self._host, self._port, ssl=self._ssl), timeout=1.0
        )
        try:
            commands = []
            if self._password is not None:
                commands.append(self._command("AUTH", self._password))
            if self._database:
                commands.append(self._command("SELECT", str(self._database)))
            commands.append(
                self._command("EVAL", self._SCRIPT, "1", key, str(window_seconds))
            )
            writer.write(b"".join(commands))
            await writer.drain()
            for _ in commands[:-1]:
                response = await asyncio.wait_for(reader.readline(), timeout=1.0)
                if not response.startswith(b"+"):
                    raise ConnectionError("Redis setup command failed")
            response = await asyncio.wait_for(reader.readline(), timeout=1.0)
            if not response.startswith(b":"):
                raise ConnectionError("Redis rate command failed")
            return int(response[1:-2])
        finally:
            writer.close()
            await writer.wait_closed()


async def safely_increment(limiter: object, key: str, window_seconds: int) -> int:
    try:
        return await limiter.increment(key, window_seconds)  # type: ignore[attr-defined]
    except Exception:
        logger.exception("API rate limiter unavailable; allowing request")
        return 0
