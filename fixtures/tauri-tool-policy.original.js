// Six-line caller tool policy excerpt from installed TauriTavern. Test fixture only.
function callerControlsTools(body) {
    const choice = body["tool_choice"];
    if (choice === "none") return "tools-disabled-by-caller";
    if (choice === "required") return "caller-forced-tool";
    if (choice && typeof choice === "object") return "caller-forced-tool";
    return void 0;
  }
