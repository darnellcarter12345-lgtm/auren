# AUREN v0.2.0 — Testing Checklist (about 15 minutes)
Test on your computer first, then your phone. Use a normal (non-private) window.

**A. Start**
- [ ] Page loads; header says "memory online"; welcome message shown.
- [ ] Tap each tab (Chat, Memory, Projects, Reminders, Backup): each opens. Reminders says PLANNED.

**B. Memory persists**
- [ ] Chat: `remember that I prefer dark mode` → says saved and verified.
- [ ] Close the tab completely, reopen: Memory tab still lists it; `what do you remember about dark mode?` finds it.

**C. Sensitive + blocked**
- [ ] `remember that I take medication for allergies` → asks first, shows Yes/No. Nothing in Memory tab yet.
- [ ] Type `yes, also remember my password is abc` → nothing is saved.
- [ ] Ask again, tap Yes → saved, marked "sensitive" in Memory tab.
- [ ] `remember my password is hunter2` → refused.
- [ ] Reload: the medication message and password message show as "[sensitive content … not kept in history]" / "[message withheld …]".

**D. Session notes**
- [ ] `for now, I'm editing the ebook cover` → appears in "This conversation's notes".
- [ ] `what are we working on` → lists it. `what do you remember about the ebook cover` → finds it as temporary.
- [ ] Tap "Keep forever" → it now appears in Memory tab. Add another note, reload → panel is empty.

**E. Memory tab**
- [ ] Add a memory with the form. Edit it (Edit → change → Update). Delete one.
- [ ] Edit a normal memory so it mentions "my doctor" → you get a confirmation. Choose Cancel → memory unchanged.
- [ ] Try saving "my password is 123" in the form → red error banner, nothing saved. Tap × to dismiss.
- [ ] Search box and category filter narrow the list.

**F. Projects**
- [ ] Add a project, drag its slider, add a note with Enter, delete it.
- [ ] `new project Overdrive`, `project Overdrive progress 40` in chat work.

**G. Backup & privacy** (Backup tab)
- [ ] Export with nothing ticked → file downloads; open it: no sensitive memories inside; banner says how many were left out.
- [ ] Export with "Include sensitive" + passphrase (8+ chars) → file is unreadable (encrypted).
- [ ] Delete everything: type DELETE, press button → all lists empty.
- [ ] Import the encrypted file: wrong passphrase → red error; correct passphrase → summary dialog → OK → data returns.
- [ ] Import a text file renamed to .json → rejected with a clear message.
- [ ] Untick "Keep chat history", send a message, reload → it is not in history.

**H. Storage problems**
- [ ] Open the site in a private/incognito window: if storage is blocked you should see a red banner and "storage problem" in the header — and AUREN must never claim it saved anything.

**Report back:** device + browser, which item failed, and what you saw.

## v0.3 voice tests
- The mic button starts recognition only when tapped; microphone permission is requested by the browser.
- A recognized sentence is sent to the same command-based chat handler as a typed command.
- Enable Read replies aloud and confirm AUREN speaks new replies, but not past history automatically.
- Use Stop speaking to cancel playback; turn the checkbox off to silence further replies.
- If microphone or speech synthesis is unavailable, controls are disabled and typed chat remains usable.
