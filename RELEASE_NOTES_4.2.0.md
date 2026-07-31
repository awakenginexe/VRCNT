# VRCNT 4.2.0

## Fixed

- Silence and music rejected by Whisper VAD no longer create translation
  requests.
- Google and Bing remain alternating primary providers; a failed message goes
  directly to CTranslate2 instead of trying the other cloud provider.
- Enabled local fallback stays warm across engine, tab, model, device, and
  compute-type changes.
- Parallel local translations cannot overwrite each other's tokenizer source
  language.
- Separate cloud translation jobs retain independent five-second deadlines, so
  one slow message cannot create the old serialized timeout backlog.

## Resource behavior

Enabling Fallback keeps CTranslate2 resident in RAM or VRAM while translation
is enabled. It remains idle until the assigned cloud provider fails, times out,
or is cooling down. Disabling Fallback releases the local model unless
CTranslate2 is the selected primary provider.
