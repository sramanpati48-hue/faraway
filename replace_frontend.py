import re

with open("web_app/components/voice/VoiceModeratorPrompt.tsx", "r", encoding="utf-8") as f:
    code = f.read()

# Remove the text input fallback form
text_input_pattern = re.compile(r"\{\/\* Text input fallback \*\/\}.*?<\/form>", re.DOTALL)
if text_input_pattern.search(code):
    new_buttons = """
            {/* Action buttons */}
            <div className="w-full flex items-center justify-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => setSpeechNotice("Please try speaking into the microphone again.")}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[#00634B] transition-colors"
              >
                <RefreshCw className="size-3" />
                Retry Microphone
              </button>
              
              <button
                type="button"
                onClick={() => setSpeechNotice("Connecting you to assisted digital support...")}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[#00634B] transition-colors"
              >
                <MessageSquare className="size-3" />
                Assisted Support Options
              </button>
            </div>
    """
    code = text_input_pattern.sub(new_buttons, code)
    print("Replaced text input with buttons.")
else:
    print("Text input fallback not found.")

with open("web_app/components/voice/VoiceModeratorPrompt.tsx", "w", encoding="utf-8") as f:
    f.write(code)
