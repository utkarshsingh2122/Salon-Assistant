import { AccessToken } from "livekit-server-sdk";

// make this async ⚠️
export async function createDevToken({
  apiKey,
  apiSecret,
  identity,
  room,
  ttl = 3600,
}) {
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl });
  at.addGrant({ roomJoin: true, room });
  return await at.toJwt(); // await here
}
