---
description: Start or join a multi-sibling conversation
user-invocable: true
---

# Conversation Skill

Enable real-time, multi-turn conversations between sibling Claude instances. User sets up the conversation via a wizard flow, then agents poll and respond autonomously until consensus or turn limit.

## Mode Detection

When this skill is invoked, determine the mode:

1. **If arguments provided** (e.g., `/conversation list`, `/conversation show th-xxx`):
   - Handle as management command (see Management Commands section)

2. **If no conversation context and no setup in progress**:
   - This instance should enter **Listen Mode** (participant)
   - Wait for a conversation invite

3. **If setting up a new conversation** (user just invoked `/conversation` and wants to start one):
   - Ask: "Do you want to **start** a new conversation or **listen** for invites?"
   - If "start" → enter **Caller Mode** (wizard flow)
   - If "listen" → enter **Listen Mode**

---

## Caller Mode (Wizard Flow)

When starting a new conversation as the caller:

### Step 1: Get Topic

```
Claude: Starting conversation setup...

        What topic do you want to discuss?
```

Wait for user to provide the topic.

### Step 2: Suggest Participants

Call `argonaut_sibling_list()` to get active siblings.

```
Claude: Topic: "[USER'S TOPIC]"

        Active siblings:
        - [NAME] ([repo]) - [relevance hint if detectable]
        - [NAME] ([repo])

        Who should participate? (comma-separated names)
```

**Relevance hints** (if topic suggests a domain):
- If topic mentions "embedding", "vector", "memory" → note siblings from argonaut-related repos
- If topic mentions "MCP", "tools" → note siblings from mcp/tools repos
- Otherwise just list them

Wait for user to specify participants.

### Step 3: Create Thread and Wait for Participants

Call `argonaut_conversation_create(topic, participants, max_turns)` with:
- `topic`: The user's topic
- `participants`: List of sibling names
- `max_turns`: Default 3 (can ask user for complex topics)

```
Claude: Conversation ready:
        - Topic: "[TOPIC]"
        - Participants: [NAMES]
        - Max turns: 3

        Please get participants into listen mode:
          -> [NAME]'s window: /conversation
          -> [NAME]'s window: /conversation

        Waiting for participants...
        - [NAME]: not yet...
        - [NAME]: not yet...
```

### Step 4: Poll for Participant Readiness

Enter a polling loop:

1. Call `argonaut_conversation_poll(thread_id)` to check listener_status
2. Update display when participants become ready:
   ```
   - [NAME]: listening ✓
   - [NAME]: not yet...
   ```
3. When all participants ready:
   ```
   Claude: All participants ready! Say "start" to begin.
   ```

4. If user says "start" (or similar), proceed to Step 5
5. If user says "cancel", cancel and exit

### Step 5: Begin Conversation

When user says "start":

```
Claude: ================================================================
        CONVERSATION STARTED - POLLING AUTOMATICALLY
        ================================================================
```

Call `argonaut_conversation_send(thread_id, "opening", content)` with your opening question based on the topic.

Display:
```
[HH:MM:SS] Sent opening question
[HH:MM:SS] Waiting for [PARTICIPANTS]...
```

### Step 6: Caller Poll Loop

Enter the main poll loop. Repeatedly:

1. Call `argonaut_conversation_poll(thread_id, since_message_id)` every 2 seconds
2. Process new messages:

**When a RESPONSE is received:**
```
[HH:MM:SS] [SENDER] responded ([WORD_COUNT] words)
```

**When ALL participants have responded for this turn:**

Synthesize the responses. Analyze:
- Is there consensus? (positions are compatible or all agree)
- What are key points of agreement?
- What are remaining disagreements?
- If no consensus, what follow-up would help?

**If consensus detected:**
```
[HH:MM:SS] Synthesizing responses...
[HH:MM:SS] Consensus detected!
[HH:MM:SS] Sending conclusion to all participants...
```

Call `argonaut_conversation_conclude(thread_id, conclusion, rationale)` and proceed to Step 7.

**If no consensus but turns remaining:**
```
[HH:MM:SS] Synthesizing responses...
[HH:MM:SS] Follow-up sent (turn N/MAX)
```

Call `argonaut_conversation_send(thread_id, "followup", your_followup_question)`.
Increment turn counter, continue polling.

**If max turns reached without consensus:**
```
[HH:MM:SS] Max turns reached, concluding...
```

Formulate conclusion noting lack of full consensus. Record divergent positions.
Call `argonaut_conversation_conclude(thread_id, conclusion, rationale)`.
Proceed to Step 7.

### Step 7: Record and Display Conclusion

```
[HH:MM:SS] Recording as DECISION memory...

================================================================
CONVERSATION CONCLUDED

Topic: [TOPIC]
Conclusion: [CONCLUSION]
Rationale: [RATIONALE]
Participants: [ALL PARTICIPANTS INCLUDING SELF]
Turns: [COUNT]
Recorded as: [MEMORY_ID] (in your Argonaut DB)
================================================================

Back to normal operation.
```

Call `argonaut_remember()` with:
- `memory_type`: "DECISION"
- `content`: Formatted conclusion including thread ID, topic, participants, conclusion, rationale
- `confidence`: 0.9 if consensus, 0.7 if no consensus

---

## Listen Mode (Participant)

When entering listen mode (not the caller):

### Step 1: Register as Listening

Call `argonaut_conversation_listen()` to register as available.

```
Claude: Entering listen mode...
        Waiting for conversation invite (timeout: 60s)
```

### Step 2: Poll for Invite

Check the pending_invites from listen(). If there's an active thread you're invited to, join it.

**If invite received:**
```
[HH:MM:SS] Conversation started by [CALLER]
           Topic: "[TOPIC]"
```

Proceed to Step 3.

**If 60 seconds pass with no invite:**
```
Claude: Listen mode timed out (60s). No conversation started.
        Use /conversation again when ready.

        Back to normal operation.
```

Exit listen mode.

### Step 3: Participant Response Loop

Enter the response polling loop:

1. Call `argonaut_conversation_poll(thread_id, since_message_id)` every 2 seconds

**When OPENING or FOLLOWUP received:**
```
[HH:MM:SS] Received [opening question/follow-up] from [SENDER]
[HH:MM:SS] Formulating response...
```

Formulate your response considering:
- The topic and question asked
- Your perspective based on your domain/context
- Previous responses in the thread (if any)

Structure your response with:
- `position`: Your stance on the question
- `reasoning`: Why you hold this position
- `stance`: AGREE, DISAGREE, PARTIAL, or NEUTRAL

Call `argonaut_conversation_send(thread_id, "response", content, position, reasoning, stance)`.

```
[HH:MM:SS] Sent response
[HH:MM:SS] Waiting for next turn...
```

**When CONCLUSION received:**
```
[HH:MM:SS] Received CONCLUSION from [SENDER]
[HH:MM:SS] Recording as DECISION memory...

================================================================
CONVERSATION CONCLUDED

Conclusion: [CONCLUSION]
Recorded as: [MEMORY_ID] (in your Argonaut DB)
================================================================

Back to normal operation.
```

Call `argonaut_remember()` with:
- `memory_type`: "DECISION"
- `content`: The conclusion with provenance (thread_id, topic, participants)
- `confidence`: Match the caller's (0.9 if consensus, 0.7 if not)

Exit the response loop.

---

## Timeout Handling

### Turn Timeout (120 seconds)

If waiting for responses and 120 seconds pass:

**As Caller:**
```
Claude: [NAME] hasn't responded in 2 minutes.

        Options:
        1. Wait longer
        2. Proceed without [NAME]
        3. Conclude with current understanding

        What would you like to do? [1/2/3]
```

Handle user choice appropriately.

**As Participant:**
If no new messages for 120 seconds, assume caller disconnected:
```
Claude: No activity for 2 minutes. Caller may have disconnected.
        Exiting conversation.

        Back to normal operation.
```

---

## Consensus Detection Guidelines

When synthesizing responses, determine consensus:

**Consensus reached if:**
- All participants have stance AGREE
- All participants have compatible positions (PARTIAL with no contradictions)
- Disagreements are minor and can be reconciled

**No consensus if:**
- Any participant has stance DISAGREE on core issue
- Positions are fundamentally incompatible
- Key disagreements remain unresolved

---

## Management Commands

### /conversation list

Call `argonaut_conversation_status()` (no thread_id) to get recent threads.

### /conversation show <thread_id>

Call `argonaut_conversation_poll(thread_id)` to get all messages.

### /conversation cancel

Only works if you're the caller of an active conversation.

---

## MCP Tools Reference

Tools you will call:

| Tool | Purpose |
|------|---------|
| `argonaut_sibling_list()` | Get active siblings for participant suggestions |
| `argonaut_sibling_whoami()` | Get your own sibling name |
| `argonaut_conversation_create(topic, participants, max_turns)` | Create new thread (caller) |
| `argonaut_conversation_listen()` | Register as listening for invites (participant) |
| `argonaut_conversation_send(thread_id, message_type, content, position?, reasoning?, stance?)` | Send message to thread |
| `argonaut_conversation_poll(thread_id, since_message_id?)` | Get new messages |
| `argonaut_conversation_status(thread_id?)` | Get thread status or list threads |
| `argonaut_conversation_conclude(thread_id, conclusion, rationale)` | End conversation |
| `argonaut_remember(memory_type, content, confidence)` | Record DECISION memory |

---

## Constants

- **POLL_INTERVAL**: 2-3 seconds between polls
- **LISTEN_TIMEOUT**: 60 seconds before listen mode times out
- **TURN_TIMEOUT**: 120 seconds to wait for response per turn
- **DEFAULT_MAX_TURNS**: 3 turns before forced conclusion

---

## Purpose

The conversation skill enables structured, multi-turn dialogues between Claude instances that produce recorded decisions. Unlike async inbox messaging, conversations happen in real-time with autonomous polling, synthesis, and consensus detection. The outcome is recorded as a DECISION memory in each participant's Argonaut database, with full provenance back to the conversation thread.
