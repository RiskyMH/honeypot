export function getDiscordDate(discordId: string | bigint): Date {
    const idBigInt = BigInt(discordId);
    const discordEpochOffset = idBigInt >> 22n;
    const unixTimestampMs = discordEpochOffset + 1420070400000n;
    return new Date(Number(unixTimestampMs));
}
