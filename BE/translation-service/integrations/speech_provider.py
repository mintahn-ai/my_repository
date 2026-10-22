from gtts import gTTS


class SpeechProvider:
    def generate(self, text: str, lang: str, output_path: str) -> None:
        gTTS(text=text, lang=lang, slow=False).save(output_path)
