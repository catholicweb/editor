---
layout: false
title: Entrar en el editor
---

<!--
  Landing page for magic-link login: the emailed link arrives here as
  /magic?slug=<site>&code=<one-time-code>. EditorApp detects ?code= on mount,
  exchanges it for an editor token (POST /auth/magic) and logs the user in.
-->

<EditorApp />
