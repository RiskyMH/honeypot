import type { API } from "@discordjs/core";
import type { API as API2 } from "@discordjs/core/http-only";

export interface Cron {
    name: string;
    frequency: Bun.CronWithAutocomplete | "once" & {};
    enabled?: boolean;
    run: (api: API | API2, db: typeof import("../utils/db"), redis?: Bun.RedisClient) => Promise<void>;
}


import experimentCron from "./experiments";
import oneOffCron from "./one-off";
import ensureMsgDeleteCron from "./ensure-msg-delete";

export const runCrons = (api: API | API2, db: typeof import("../utils/db"), redis?: Bun.RedisClient) => {
    const crons = [
        experimentCron,
        oneOffCron,
        ensureMsgDeleteCron,
    ];

    const cronJobs = [] as Bun.CronJob[];
    let running = 0;

    for (const cron of crons) {
        if (cron.enabled === false) continue;
        if (cron.frequency === "once") {
            running++;
            cron.run(api, db, redis).catch(err => {
                console.log(`Error running cron ${cron.name}: ${err}`);
            }).then(() => running--);
        } else {
            const cronJob = Bun.cron(cron.frequency, () => {
                running++;
                cron.run(api, db, redis).catch(err => {
                    console.log(`Error running cron ${cron.name}: ${err}`);
                }).then(() => running--);
            });
            cronJobs.push(cronJob);
        }
    }

    return async () => {
        for (const job of cronJobs) job.stop();
        while (running > 0) await Bun.sleep(100);
        return true;
    }
}
