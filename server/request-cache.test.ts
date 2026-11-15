import { expect, it } from 'vitest';
import { cachedGet, invalidateReads } from '../src/gallery/requestCache';
it('shares concurrent reads, invalidates mutations, and retries failures', async () => {
 invalidateReads();
 let finish!: (value:number)=>void;
 const first=cachedGet('recs',()=>new Promise<number>(resolve=>{finish=resolve;}),30000);
 expect(cachedGet('recs',async()=>2,30000)).toBe(first);
 invalidateReads();
 const second=cachedGet('recs',async()=>2,30000);
 finish(1); await first; await second;
 expect(await cachedGet('recs',async()=>3,30000)).toBe(2);
 await expect(cachedGet('fail',async()=>{throw Error('offline');},30000)).rejects.toThrow('offline');
 expect(await cachedGet('fail',async()=>4,30000)).toBe(4);
});
