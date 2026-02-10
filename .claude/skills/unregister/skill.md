---
description: Remove this instance from the sibling network
user-invocable: true
---

# Unregister Skill

Remove this instance from the sibling network.

## Instructions

When this skill is invoked:

1. **Check current registration** by calling `argonaut_sibling_whoami()`
   - If not registered, inform user: "This instance isn't registered in the sibling network."
   - If registered, proceed to step 2

2. **Confirm with user**:
   - "You're registered as [NAME]. Are you sure you want to unregister?"
   - Wait for confirmation before proceeding

3. **Unregister** by calling `argonaut_sibling_unregister()`

4. **On success**, respond with:
   ```
   Unregistered from the sibling network.

   Goodbye, [NAME]. Your name is now available for others.

   You can re-register anytime with /register
   ```

## Purpose

Allows an instance to leave the sibling network, freeing up their chosen name for other instances to use.
