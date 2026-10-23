import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Any

from data.translation_repository import TranslationRepository
from data.audio_asset_repository import AudioAssetRepository
from data.offline_narration_translations import OFFLINE_NARRATION_TRANSLATIONS
from business.tts_engine import TTSService

logger = logging.getLogger(__name__)


class AudioProcessingError(Exception):
    pass


class AudioService:
    def __init__(
        self,
        repository: TranslationRepository,
        tts_service: TTSService,
        audio_dir: Path,
        translation_timeout: float = 60,
        audio_asset_repository: AudioAssetRepository | None = None,
    ):
        self.repository = repository
        self.tts_service = tts_service
        self.audio_dir = audio_dir
        self.translation_timeout = translation_timeout
        self.audio_asset_repository = audio_asset_repository
        self._generation_locks: dict[tuple[str, str], asyncio.Lock] = {}

    async def get_audio(
        self,
        site_code: str,
        source_description: str,
        lang: str,
    ) -> dict[str, Any]:
        lock = self._generation_locks.setdefault(
            (site_code, lang),
            asyncio.Lock(),
        )
        async with lock:
            return await self._get_audio_locked(
                site_code,
                source_description,
                lang,
            )

    async def _get_audio_locked(
        self,
        site_code: str,
        source_description: str,
        lang: str,
    ) -> dict[str, Any]:
        source_hash = hashlib.sha256(source_description.encode("utf-8")).hexdigest()
        cached = await self.repository.get(site_code, lang)
        if cached and cached.get("source_hash") == source_hash:
            cached_file = cached.get("audio_filename")
            if cached_file:
                cached_path = self.audio_dir / cached_file
                if cached_path.is_file() and cached_path.stat().st_size > 0:
                    return cached
                if cached_path.is_file():
                    cached_path.unlink()

        if (
            cached
            and cached.get("source_text") == source_description
            and self.audio_asset_repository is not None
        ):
            try:
                imported_asset = await self.audio_asset_repository.get(
                    site_code,
                    lang,
                )
            except ValueError as exc:
                logger.exception(
                    "Imported audio asset is invalid for site=%s lang=%s",
                    site_code,
                    lang,
                )
                raise AudioProcessingError("Imported audio asset is invalid.") from exc
            if imported_asset is not None:
                filename = f"imported_{site_code}_{lang}.mp3"
                audio_path = self.audio_dir / filename
                await asyncio.to_thread(
                    audio_path.write_bytes,
                    imported_asset["data"],
                )
                return {
                    "site_code": site_code,
                    "language": lang,
                    "description": cached.get("description", source_description),
                    "audio_filename": filename,
                    "source_hash": source_hash,
                    "translation_cache": "HIT",
                    "audio_cache": "HIT",
                }

        if lang == "vi":
            description = source_description
        else:
            offline_translation = OFFLINE_NARRATION_TRANSLATIONS.get(site_code)
            offline_description = (
                offline_translation["translations"].get(lang)
                if offline_translation
                and offline_translation["source_text"] == source_description
                else None
            )
            if offline_description:
                description = offline_description
                logger.info(
                    "Using offline narration translation for site=%s lang=%s",
                    site_code,
                    lang,
                )
            else:
                try:
                    description = await asyncio.wait_for(
                        self.tts_service.translate_text_async(
                            source_description,
                            lang,
                            source_lang="vi",
                        ),
                        timeout=self.translation_timeout,
                    )
                except asyncio.TimeoutError:
                    raise
                except Exception as exc:
                    logger.exception(
                        "Translation provider failed for site=%s lang=%s",
                        site_code,
                        lang,
                    )
                    raise AudioProcessingError("Translation provider failed.") from exc
        if not isinstance(description, str) or not description.strip():
            raise RuntimeError("Translation provider returned empty text.")
        description = description.strip()

        try:
            audio_path, audio_hit, cache_key = await self.tts_service.generate_audio(
                description,
                target_lang=lang,
                do_translate=False,
            )
        except Exception as exc:
            logger.exception(
                "Speech provider failed for site=%s lang=%s",
                site_code,
                lang,
            )
            raise AudioProcessingError("Speech provider failed.") from exc
        filename = Path(audio_path).name
        generated_path = self.audio_dir / filename
        if not generated_path.is_file() or generated_path.stat().st_size == 0:
            if generated_path.is_file():
                generated_path.unlink()
            raise AudioProcessingError("Speech provider returned an empty audio file.")
        result = {
            "site_code": site_code,
            "language": lang,
            "description": description,
            "audio_filename": filename,
            "source_hash": source_hash,
            "translation_cache": "MISS",
            "audio_cache": "HIT" if audio_hit else "MISS",
            "audio_cache_key": cache_key,
        }
        await self.repository.save(result)
        return result
