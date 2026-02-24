

const url = "https://potentiallyoffensive.com/wp-content/uploads/2023/03/OffensiveWords-comma-separated-text.txt";
const cacheFile = `${import.meta.dirname}/../node_modules/${Bun.hash(url)}.json`;

export default async function getBadWords(): Promise<string[]> {
    const file = Bun.file(cacheFile);
    if (await file.exists()) {
        const existing = await file.text();
        return JSON.parse(existing) as string[];
    }
    const res = await fetch(url);
    const text = await res.text();
    const words = text.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
    await Bun.write(cacheFile, JSON.stringify(words));
    return words;
}
