import hashlib
import os


class AudioFileRepository:
    def get_pack_manifest(self, cache_dir: str, lang: str):
        files_data = []
        total_bytes = 0

        if os.path.exists(cache_dir):
            for filename in os.listdir(cache_dir):
                if not filename.endswith(".mp3") or not filename.startswith(f"{lang}_"):
                    continue

                file_path = os.path.join(cache_dir, filename)
                file_size = os.path.getsize(file_path)
                total_bytes += file_size

                sha256_hash = hashlib.sha256()
                with open(file_path, "rb") as audio_file:
                    for byte_block in iter(lambda: audio_file.read(4096), b""):
                        sha256_hash.update(byte_block)

                files_data.append({
                    "name": filename,
                    "size_bytes": file_size,
                    "sha256": sha256_hash.hexdigest(),
                })

        return {
            "lang": lang,
            "pack_version": "v1.0.0",
            "total_files": len(files_data),
            "total_bytes": total_bytes,
            "files": files_data,
        }
