import { getInterview, addTranscriptEntry, getProctoringViolationCount, addProctoringEvent } from "@/lib/store";
import { stripThinking, buildInterviewPrompt } from "@/lib/ai";
import { validateAccessPost } from "@/lib/auth-check";
import { rateLimit } from "@/lib/rate-limit";
import { pool } from "@/lib/db";
import { getTTSProvider } from "@/lib/providers";
import { canEndNow, getRemainingSeconds } from "@/lib/interview-time";
import { cleanForTTS } from "@/lib/tts-text";
import { stripMarkers } from "@/lib/phase-engine";
import { finalizeDsaTurn, isDsaReview, prepareDsaTurn, type DsaTurnPrep } from "@/lib/dsa-turn";
import { finishInterview } from "@/lib/scoring/background";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 30, 60000)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 });
    }

    const { interviewId, transcript, token, skipSave, tts, scratchpad, trigger } = await req.json();
    const ttsEnabled = tts !== false; // candidate can turn the AI voice off (text-only)
    if (!interviewId) {
      return new Response(JSON.stringify({ error: "Missing interviewId" }), { status: 400 });
    }

    if (!(await validateAccessPost(interviewId, token))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
    }

    // Parallel: interview + violations + heartbeat
    const [interview, violations, hbResult] = await Promise.all([
      getInterview(interviewId),
      getProctoringViolationCount(interviewId),
      pool.query("SELECT last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]),
    ]);

    if (!interview) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }
    if (interview.status === "completed") {
      return new Response(JSON.stringify({ error: "Interview already completed" }), { status: 400 });
    }

    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || process.env.NEXT_PUBLIC_MAX_PROCTORING_STRIKES || "25");
    console.log(`[Proctoring] Interview ${interviewId}: violations=${violations}/${MAX_STRIKES}`);
    if (violations >= MAX_STRIKES) {
      return new Response(JSON.stringify({ error: "Interview terminated" }), { status: 403 });
    }

    // Heartbeat check (fire-and-forget)
    const hbRows = hbResult.rows;
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const elapsed = Date.now() - new Date(hbRows[0].last_heartbeat_at).getTime();
      if (elapsed > 120000) {
        addProctoringEvent(interviewId, {
          type: "heartbeat_missing", severity: "flag",
          message: `No heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // DSA Review: the server owns the phase, the history and the prompt (see lib/dsa-turn.ts)
    let dsaPrep: DsaTurnPrep | null = null;
    let aiMessages: { role: string; content: string }[];
    if (isDsaReview(interview)) {
      const lastEntry = transcript?.length > 0 ? transcript[transcript.length - 1] : null;
      const candidateText = lastEntry?.role === "candidate" ? lastEntry.text : null;
      dsaPrep = await prepareDsaTurn(interview, {
        candidateText: skipSave ? null : candidateText,
        skipSave: !!skipSave,
        ephemeralText: skipSave ? candidateText : null,
        trigger: trigger === "phase_open" ? "phase_open" : undefined,
        scratchpad: typeof scratchpad === "string" ? scratchpad : undefined,
      });
      aiMessages = dsaPrep.messages;
    } else {
      // Save candidate message (fire-and-forget)
      if (!skipSave && transcript?.length > 0) {
        const lastEntry = transcript[transcript.length - 1];
        if (lastEntry.role === "candidate" && lastEntry.text) {
          addTranscriptEntry(interviewId, {
            role: "candidate", text: lastEntry.text, timestamp: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      // Build AI messages using full interview prompt
      aiMessages = buildInterviewPrompt(interview, transcript || interview.transcript);
    }

    // Stream AI response + TTS pipeline
    const encoder = new TextEncoder();
    const ttsProvider = getTTSProvider();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (data: Uint8Array) => {
          if (closed) return;
          try { controller.enqueue(data); } catch { closed = true; }
        };
        const safeClose = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch {}
        };
        // AI fetch with retry — try twice with 35s timeout each
        const startTime = Date.now();
        const makeAICall = async (attempt: number) => {
          const abort = new AbortController();
          const timeout = setTimeout(() => abort.abort(), 35000);
          console.log(`[Stream] AI call attempt ${attempt} for ${interviewId} (model=${process.env.AI_MODEL}, messages=${aiMessages.length})`);
          try {
            const res = await fetch(`${process.env.AI_BASE_URL}/v1/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.AI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: process.env.AI_MODEL || "minimaxai/minimax-m2",
                messages: aiMessages,
                max_tokens: 700, // ~200 wasted on reasoning_content + ~500 actual content
                temperature: 0.3,
                stream: true,
                // Only send thinking param for MiniMax models (Groq/OpenAI reject it)
                ...((process.env.AI_MODEL || "").includes("minimax") ? { thinking: { type: "disabled" } } : {}),
                // Reasoning models (e.g. glm via LiteLLM) can burn the whole token budget thinking → empty reply.
                ...(process.env.AI_REASONING_EFFORT ? { reasoning_effort: process.env.AI_REASONING_EFFORT } : {}),
              }),
              signal: abort.signal,
            });
            clearTimeout(timeout);
            console.log(`[Stream] AI call attempt ${attempt} responded in ${Date.now() - startTime}ms (status=${res.status})`);
            return res;
          } catch (err) {
            clearTimeout(timeout);
            console.error(`[Stream] AI call attempt ${attempt} failed in ${Date.now() - startTime}ms:`, (err as Error).message);
            throw err;
          }
        };

        try {
          let aiRes: Response;
          try {
            aiRes = await makeAICall(1);
            // Retry on 5xx — Cerebras occasionally returns transient 503
            if (aiRes.status >= 500 && aiRes.status < 600) {
              console.warn(`[Stream] AI returned ${aiRes.status} on attempt 1, retrying...`);
              aiRes = await makeAICall(2);
            }
          } catch (firstErr) {
            console.warn(`[Stream] Retrying AI call for ${interviewId}...`);
            aiRes = await makeAICall(2);
          }

          if (!aiRes.ok || !aiRes.body) {
            console.error(`[Stream] AI returned ${aiRes.status} for ${interviewId}`);
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI failed" })}\n\n`));
            safeClose();
            return;
          }

          const reader = aiRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let fullText = "";
          let sentenceIdx = 0;
          const ttsPromises: Promise<void>[] = [];

          const processSentence = (sentence: string) => {
            const cleaned = stripMarkers(stripThinking(sentence));
            if (!cleaned) return;
            const idx = sentenceIdx++;

            // Send original text for transcript
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: cleaned, idx })}\n\n`));

            if (!ttsEnabled) return; // voice off: text only, skip synthesis (also saves cost)

            // Clean for TTS — remove special chars and end signal
            const ttsText = cleanForTTS(cleaned);
            if (!ttsText) return;

            // Generate TTS in parallel (client plays in order using idx)
            const p = ttsProvider.synthesize(ttsText).then((audioBuffer) => {
              const audioBase64 = audioBuffer.toString("base64");
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: "audio",
                audio: audioBase64,
                contentType: ttsProvider.contentType,
                idx,
              })}\n\n`));
            }).catch((err: any) => {
              console.warn(`[Stream] TTS failed for sentence ${idx}:`, err.message);
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "audio_skip", idx })}\n\n`));
            });
            ttsPromises.push(p);
          };

          // Read AI stream
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
              try {
                const json = JSON.parse(line.slice(6));
                // IMPORTANT: only read `content`, NOT `reasoning_content`.
                // Some models (e.g. MiniMax-M2.5) stream reasoning_content first
                // (the model's internal thinking) followed by the actual content.
                // We must not speak the model's reasoning out loud — skip it.
                const delta = json.choices?.[0]?.delta || {};
                const token = delta.content || "";
                if (!token) continue;
                buffer += token;
                fullText += token;

                // Check for sentence boundary
                const sentenceMatch = buffer.match(/[.!?]\s/);
                if (sentenceMatch) {
                  const idx = sentenceMatch.index! + 1;
                  const sentence = buffer.slice(0, idx).trim();
                  buffer = buffer.slice(idx);
                  if (sentence) processSentence(sentence);
                }
              } catch {}
            }
          }

          // Flush remaining buffer
          if (buffer.trim()) processSentence(buffer.trim());

          // Wait for all parallel TTS to complete
          console.log(`[Stream] AI done for ${interviewId} in ${Date.now() - startTime}ms (${sentenceIdx} sentences, waiting for TTS...)`);
          await Promise.all(ttsPromises);
          console.log(`[Stream] TTS done for ${interviewId} in ${Date.now() - startTime}ms total`);

          if (dsaPrep) {
            // Parse and apply markers (assess / hint / phase done / end), save the clean AI entry
            const result = await finalizeDsaTurn(dsaPrep, fullText);
            if (result.endInterview) {
              console.log(`[Stream] AI ended DSA interview ${interviewId}`);
              await finishInterview(interviewId, interview.roundType);
            }
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: "done",
              fullText: result.text,
              endInterview: result.endInterview,
              phase: result.phase,
              phaseTransition: result.phaseTransition,
              hintUsed: result.hintUsed,
            })}\n\n`));
            safeClose();
            return;
          }

          // Check for [END_INTERVIEW] signal — AI decided to close
          const aiWantsEnd = fullText.includes("[END_INTERVIEW]");
          // Server-side guard: ignore an early end signal — the AI may only close in the final minutes.
          const hasEndSignal = aiWantsEnd && canEndNow(interview);
          if (aiWantsEnd && !hasEndSignal) {
            console.warn(`[Stream] Ignored early [END_INTERVIEW] for ${interviewId} — ${getRemainingSeconds(interview)}s still remain`);
          }
          const cleanedFull = stripMarkers(stripThinking(fullText));

          if (cleanedFull) {
            await addTranscriptEntry(interviewId, {
              role: "ai", text: cleanedFull, timestamp: new Date().toISOString(),
            });
          }

          // If AI signaled end, mark interview as completed + trigger scorecard
          if (hasEndSignal) {
            console.log(`[Stream] AI ended interview ${interviewId}`);
            await finishInterview(interviewId, interview.roundType);
          }

          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", fullText: cleanedFull, endInterview: hasEndSignal })}\n\n`));
          safeClose();
        } catch (err) {
          console.error("[Stream] Error:", err);
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
          safeClose();
        } finally {
          // timeouts are cleared inside makeAICall
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Stream error:", error);
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500 });
  }
}
