export const settingsSections = [
    {
        id: "device",
        label: "Device",
        eyebrow: "Audio I/O",
        description: "Choose the devices VRCNT listens to and plays through.",
        groups: [
            {
                title: "Microphone",
                controls: [
                    { label: "Auto select microphone", type: "toggle", value: true },
                    { label: "Host API", type: "select", value: "Windows WASAPI" },
                    { label: "Input device", type: "select", value: "Default microphone" },
                ],
            },
            {
                title: "Microphone energy threshold",
                controls: [
                    { label: "Automatic threshold", type: "toggle", value: true },
                    { label: "Manual threshold", type: "range", value: "320" },
                ],
            },
            {
                title: "Speaker",
                controls: [
                    { label: "Auto select speaker", type: "toggle", value: true },
                    { label: "Output device", type: "select", value: "Default speaker" },
                ],
            },
            {
                title: "Speaker energy threshold",
                controls: [
                    { label: "Automatic threshold", type: "toggle", value: true },
                    { label: "Manual threshold", type: "range", value: "320" },
                ],
            },
        ],
    },
    {
        id: "appearance",
        label: "Appearance",
        eyebrow: "Interface",
        description: "Make the desktop interface comfortable and readable.",
        groups: [
            {
                title: "Language & scale",
                controls: [
                    { label: "UI language", type: "select", value: "English" },
                    { label: "UI size", type: "select", value: "100%" },
                    { label: "Message log / textbox size", type: "select", value: "100%" },
                    { label: "Font family", type: "select", value: "System default" },
                ],
            },
            {
                title: "Conversation controls",
                controls: [
                    { label: "Send message button", type: "select", value: "Show" },
                    { label: "Show resend button", type: "toggle", value: true },
                ],
            },
            {
                title: "Window",
                controls: [
                    { label: "Transparency", type: "range", value: "92%" },
                    { label: "Performance mode", type: "toggle", value: false },
                ],
            },
        ],
    },
    {
        id: "translation",
        label: "Translation",
        eyebrow: "Providers",
        description: "Configure local and cloud translation engines.",
        groups: [
            {
                title: "Local translation",
                controls: [
                    { label: "CTranslate2 model / weight", type: "download", value: "Manage models" },
                    { label: "Translation compute device", type: "select", value: "Auto" },
                ],
            },
            {
                title: "DeepL & Plamo",
                controls: [
                    { label: "DeepL API key", type: "secret", value: "Not configured" },
                    { label: "Plamo API key", type: "secret", value: "Not configured" },
                    { label: "Plamo model", type: "select", value: "plamo-2-translate" },
                ],
            },
            {
                title: "Gemini & OpenAI",
                controls: [
                    { label: "Gemini API key", type: "secret", value: "Not configured" },
                    { label: "Gemini model", type: "select", value: "gemini-2.0-flash" },
                    { label: "OpenAI API key", type: "secret", value: "Not configured" },
                    { label: "OpenAI model", type: "select", value: "gpt-4.1-mini" },
                ],
            },
            {
                title: "Groq & OpenRouter",
                controls: [
                    { label: "Groq API key", type: "secret", value: "Not configured" },
                    { label: "Groq model", type: "select", value: "llama-3.3-70b" },
                    { label: "OpenRouter API key", type: "secret", value: "Not configured" },
                    { label: "OpenRouter model", type: "select", value: "Auto" },
                ],
            },
            {
                title: "Local servers",
                controls: [
                    { label: "LM Studio connection", type: "status", value: "Check connection" },
                    { label: "LM Studio URL", type: "text", value: "http://localhost:1234" },
                    { label: "LM Studio model", type: "text", value: "Loaded model" },
                    { label: "Ollama connection", type: "status", value: "Check connection" },
                    { label: "Ollama model", type: "text", value: "llama3.2" },
                ],
            },
        ],
    },
    {
        id: "transcription",
        label: "Transcription",
        eyebrow: "Speech recognition",
        description: "Tune capture timing, recognition engines, and decoding.",
        groups: [
            {
                title: "Microphone capture",
                controls: [
                    { label: "Mic record timeout", type: "number", value: "3.0 sec" },
                    { label: "Mic phrase timeout", type: "number", value: "2.0 sec" },
                    { label: "Mic max phrase", type: "number", value: "10.0 sec" },
                    { label: "Mic word filter", type: "text", value: "Comma-separated words" },
                ],
            },
            {
                title: "Speaker capture",
                controls: [
                    { label: "Speaker record timeout", type: "number", value: "3.0 sec" },
                    { label: "Speaker phrase timeout", type: "number", value: "2.0 sec" },
                    { label: "Speaker max phrase", type: "number", value: "10.0 sec" },
                ],
            },
            {
                title: "Recognition engine",
                controls: [
                    { label: "Transcription engine", type: "select", value: "Whisper" },
                    { label: "Vosk model", type: "download", value: "Manage models" },
                    { label: "NVIDIA Parakeet model", type: "download", value: "Manage models" },
                    { label: "SenseVoice-Small model", type: "download", value: "Manage models" },
                    { label: "Whisper model", type: "download", value: "large-v3-turbo" },
                    { label: "Whisper decoding profile", type: "segmented", value: "Balanced" },
                    { label: "Transcription compute device", type: "select", value: "Auto" },
                ],
            },
            {
                title: "Whisper advanced",
                controls: [
                    { label: "Mic average log probability", type: "number", value: "-0.8" },
                    { label: "Mic no-speech probability", type: "number", value: "0.6" },
                    { label: "Speaker average log probability", type: "number", value: "-0.8" },
                    { label: "Speaker no-speech probability", type: "number", value: "0.6" },
                ],
            },
        ],
    },
    {
        id: "vr",
        label: "VR",
        eyebrow: "Overlay",
        description: "Position and tune the VRChat translation overlay.",
        groups: [
            {
                title: "Overlay behavior",
                controls: [
                    { label: "Overlay text layout", type: "segmented", value: "Multi-line" },
                    { label: "Enable overlay", type: "toggle", value: true },
                    { label: "Position / rotation mode", type: "toggle", value: false },
                    { label: "Tracker", type: "select", value: "HMD" },
                    { label: "Restore default settings", type: "danger", value: "Restore" },
                ],
            },
            {
                title: "Position",
                controls: [
                    { label: "X position", type: "number", value: "0.00" },
                    { label: "Y position", type: "number", value: "-0.35" },
                    { label: "Z position", type: "number", value: "1.20" },
                ],
            },
            {
                title: "Rotation",
                controls: [
                    { label: "X rotation", type: "number", value: "0°" },
                    { label: "Y rotation", type: "number", value: "0°" },
                    { label: "Z rotation", type: "number", value: "0°" },
                ],
            },
            {
                title: "Visuals & timing",
                controls: [
                    { label: "Overlay background", type: "segmented", value: "Transparent black" },
                    { label: "Opacity", type: "range", value: "80%" },
                    { label: "UI scaling", type: "range", value: "100%" },
                    { label: "Display duration", type: "number", value: "8 sec" },
                    { label: "Fadeout duration", type: "number", value: "1 sec" },
                    { label: "Log order", type: "segmented", value: "Newest first" },
                ],
            },
            {
                title: "Common settings",
                controls: [
                    { label: "Show only translated messages", type: "toggle", value: false },
                    { label: "Voice typing mode", type: "toggle", value: false },
                    { label: "Sample text preview", type: "action", value: "Start preview" },
                ],
            },
        ],
    },
    {
        id: "others",
        label: "Others",
        eyebrow: "Behavior",
        description: "Manage sounds, message formatting, logging, and VRChat behavior.",
        groups: [
            {
                title: "Sounds",
                controls: [
                    { label: "VRChat notification SFX", type: "toggle", value: true },
                ],
            },
            {
                title: "Speaker to chatbox",
                controls: [
                    { label: "Send received messages to VRChat", type: "toggle", value: false },
                ],
            },
            {
                title: "Message formats",
                controls: [
                    { label: "Sent message format", type: "text", value: "[translation]" },
                    { label: "Received message format", type: "text", value: "[translation]" },
                ],
            },
            {
                title: "General",
                controls: [
                    { label: "Auto clear message box", type: "toggle", value: true },
                    { label: "Send only translated messages", type: "toggle", value: false },
                    { label: "Auto export message logs", type: "toggle", value: false },
                    { label: "Exported log folder", type: "action", value: "Open folder" },
                    { label: "Sync VRChat mic mute", type: "toggle", value: false },
                    { label: "Send messages to VRChat", type: "toggle", value: true },
                    { label: "Convert messages to Romaji", type: "toggle", value: false },
                    { label: "Convert messages to Hiragana", type: "toggle", value: false },
                    { label: "Telemetry", type: "toggle", value: true },
                    { label: "Privacy policy", type: "link", value: "Read policy" },
                ],
            },
        ],
    },
    {
        id: "hotkeys",
        label: "Hotkeys",
        eyebrow: "Keyboard",
        description: "Set shortcuts for the controls used during a live session.",
        groups: [
            {
                title: "Application",
                controls: [
                    { label: "Toggle VRCNT visibility", type: "hotkey", value: "Ctrl + Shift + V" },
                    { label: "Toggle Translation", type: "hotkey", value: "Ctrl + Shift + T" },
                ],
            },
            {
                title: "Conversation",
                controls: [
                    { label: "Toggle Speaking / send transcription", type: "hotkey", value: "Ctrl + Shift + S" },
                    { label: "Toggle Listening / receive transcription", type: "hotkey", value: "Ctrl + Shift + L" },
                ],
            },
        ],
    },
    {
        id: "advanced",
        label: "Advanced",
        eyebrow: "Network",
        description: "Configure OSC, WebSocket, and direct configuration access.",
        groups: [
            {
                title: "OSC",
                controls: [
                    { label: "OSC IP address", type: "text", value: "127.0.0.1" },
                    { label: "OSC port", type: "number", value: "9000" },
                ],
            },
            {
                title: "Configuration",
                controls: [
                    { label: "Configuration file", type: "action", value: "Open config file" },
                ],
            },
            {
                title: "WebSocket",
                controls: [
                    { label: "Enable WebSocket", type: "toggle", value: false },
                    { label: "WebSocket host", type: "text", value: "127.0.0.1" },
                    { label: "WebSocket port", type: "number", value: "8765" },
                ],
            },
        ],
    },
    {
        id: "about",
        label: "About",
        eyebrow: "Application",
        description: "Version, project links, and application information.",
        informational: true,
        groups: [
            {
                title: "VRCNT",
                controls: [
                    { label: "Installed version", type: "status", value: "4.1.0" },
                    { label: "Project page", type: "link", value: "Open project" },
                    { label: "Check for updates", type: "action", value: "Check now" },
                ],
            },
        ],
    },
];

export const settingsControlCount = settingsSections.reduce(
    (sectionTotal, section) => sectionTotal
        + section.groups.reduce((groupTotal, group) => groupTotal + group.controls.length, 0),
    0,
);

export const configurableControlCount = settingsSections
    .filter((section) => !section.informational)
    .reduce(
        (sectionTotal, section) => sectionTotal
            + section.groups.reduce((groupTotal, group) => groupTotal + group.controls.length, 0),
        0,
    );
