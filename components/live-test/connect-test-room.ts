// The live test's call setup: token request + the room SDK. Loaded with a
// dynamic import() only when someone starts a test call, so the SDK (large,
// and full of its vendor's names) is not part of the dashboard's chunks.

import { Room, RoomEvent, Track, type RemoteAudioTrack, type RemoteTrack } from "livekit-client";

type WebTokenResponse = {
  url: string;
  token: string;
  roomName: string;
  identity: string;
};

export type TranscriptLine = { role: "user" | "assistant"; text: string };

/** What the panel needs from a connected test room. */
export type TestRoom = {
  disconnect: () => Promise<void>;
  setMicrophoneEnabled: (on: boolean) => Promise<unknown>;
};

/**
 * Creates the room and wires its events. `onCreated` hands the room back
 * before connecting, so the panel can tear it down if connecting fails.
 */
export async function connectTestRoom(opts: {
  asUserId?: string;
  agentId?: string;
  audioEl: () => HTMLAudioElement | null;
  onTranscript: (line: TranscriptLine) => void;
  onDisconnected: () => void;
  onCreated: (room: TestRoom) => void;
}): Promise<TestRoom> {
  const res = await fetch("/api/livekit/web-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(opts.asUserId ? { asUserId: opts.asUserId } : {}),
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Token endpoint ${res.status}: ${t || "no body"}`);
  }
  const { url, token } = (await res.json()) as WebTokenResponse;

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const handle: TestRoom = {
    disconnect: () => room.disconnect(),
    setMicrophoneEnabled: (on) => room.localParticipant.setMicrophoneEnabled(on),
  };
  opts.onCreated(handle);

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    const audioTrack = track as RemoteAudioTrack;
    const el = opts.audioEl();
    if (!el) return;
    audioTrack.attach(el);
    void el.play().catch(() => {
      // autoplay may be silently blocked
    });
  });

  room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
    try {
      const text = new TextDecoder().decode(payload);
      const msg = JSON.parse(text) as {
        type?: string;
        role?: "user" | "assistant";
        text?: string;
      };
      if (
        msg.type === "transcript" &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.text === "string" &&
        msg.text.trim()
      ) {
        opts.onTranscript({ role: msg.role, text: msg.text.trim() });
      }
    } catch {
      // non-JSON payload
    }
  });

  room.on(RoomEvent.Disconnected, () => opts.onDisconnected());

  await room.connect(url, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  return handle;
}
