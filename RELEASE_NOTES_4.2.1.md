# VRCNT 4.2.1

VRCNT 4.2.1 adds multilingual conversation profiles while preserving the low-latency translation routing introduced in 4.2.0.

## Multilingual profiles

- Select up to three languages you speak. Whisper detects only among those choices and decodes the winning language once.
- Google Cloud Transcription can check up to three selected speaking-language candidates in parallel. This improves multilingual recognition, but each candidate is a separate Google request.
- Select up to three Target languages. Each enabled Target receives an outgoing translation, and successful results are sent together to VRChat.
- Keep one separate preferred language for translating speech you receive—the language you understand best.
- Swap the complete speaking and Target profiles in one action without changing the preferred translation language.

## Engine behavior

- Whisper uses the selected-language profile as a detection boundary, including mixed-language phrases such as Chinese sentences containing English words.
- Google selects the successful candidate with the strongest confidence and keeps profile order as a stable tie-breaker.
- SenseVoice detects among selected languages supported by the active model.
- Vosk and Parakeet recognize the first speaking language only. Additional speaking languages remain saved and clearly appear as paused until a compatible engine is selected.

## Reliability retained from 4.2.0

- Google and Bing remain alternating primary translation services per message; one cloud failure does not retry the same message through the other cloud provider.
- CTranslate2 loads only when explicitly enabled as fallback, is preloaded before it is needed, and handles cloud-fallback work without blocking the translation queue.
- No-speech and known Whisper hallucination output is filtered before it can flood public translation APIs.
