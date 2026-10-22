import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = Path(os.getenv("AUDIO_DIR", "/tmp/ditichq1-audio"))
STARTUP_TIMEOUT_SECONDS = 60
SHUTDOWN_TIMEOUT_SECONDS = 10


def start_service(name: str, directory: str, port: int, public: bool = False):
    environment = os.environ.copy()
    environment["AUDIO_DIR"] = str(AUDIO_DIR)
    if name == "site-service":
        environment["TRANSLATION_SERVICE_URL"] = "http://127.0.0.1:8001"
    elif name == "api-gateway":
        environment["SITE_SERVICE_URL"] = "http://127.0.0.1:8000"

    host = "0.0.0.0" if public else "127.0.0.1"
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            host,
            "--port",
            str(port),
        ],
        cwd=ROOT / directory,
        env=environment,
    )


def wait_for_health(process, name: str, port: int) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    url = f"http://127.0.0.1:{port}/health"
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited during startup with code {process.returncode}.")
        try:
            with urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, URLError) as error:
            last_error = error
        time.sleep(0.5)
    raise RuntimeError(f"{name} did not become healthy: {last_error}")


def stop_services(processes) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    for process in reversed(processes):
        if process.poll() is None:
            try:
                process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main() -> int:
    def handle_shutdown(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_shutdown)
    try:
        gateway_port = int(os.getenv("PORT", "10000"))
    except ValueError as error:
        raise RuntimeError("PORT must be an integer.") from error
    if not 1 <= gateway_port <= 65535:
        raise RuntimeError("PORT must be between 1 and 65535.")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    processes = []
    try:
        for name, directory, port, public in [
            ("translation-service", "translation-service", 8001, False),
            ("site-service", "site-service", 8000, False),
            ("api-gateway", "api-gateway", gateway_port, True),
        ]:
            process = start_service(name, directory, port, public)
            processes.append(process)
            wait_for_health(process, name, port)
            print(f"{name} is healthy on port {port}.", flush=True)

        while True:
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    raise RuntimeError(
                        f"A hosted service exited unexpectedly with code {return_code}."
                    )
            time.sleep(1)
    except KeyboardInterrupt:
        return 0
    finally:
        stop_services(processes)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hosted backend startup failed: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
