import httpx


class TranslationServiceUnavailable(Exception):
    pass


class TranslationClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str):
        self.client = client
        self.base_url = base_url.rstrip("/")

    async def get_audio(
        self,
        site_code: str,
        source_description: str,
        lang: str,
    ) -> dict:
        try:
            response = await self.client.post(
                f"{self.base_url}/internal/audio/{site_code}",
                json={
                    "source_description": source_description,
                    "lang": lang,
                },
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise TranslationServiceUnavailable(
                "Translation service timed out."
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise TranslationServiceUnavailable(
                f"Translation service returned HTTP {exc.response.status_code}."
            ) from exc
        except httpx.RequestError as exc:
            raise TranslationServiceUnavailable(
                "Could not connect to translation service."
            ) from exc
        return response.json()
