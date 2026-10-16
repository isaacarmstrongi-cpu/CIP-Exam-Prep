import test from 'node:test';
import assert from 'node:assert/strict';
import {activityStrip} from '../paid/ui.mjs';
test('study rhythm shows seven local calendar days and only actual session starts within them',()=>{
 const today=new Date(2026,9,16,13),start=new Date(2026,9,10),before=new Date(2026,9,9,23,59),tomorrow=new Date(2026,9,17);
 const html=activityStrip([{startedAt:start.getTime()},{startedAt:today.getTime()},{startedAt:before.getTime()},{startedAt:tomorrow.getTime()}],today);
 assert.equal((html.match(/<li /g)||[]).length,7);assert.equal((html.match(/class="has-activity"/g)||[]).length,2);
 assert.ok(html.includes('session you started'));assert.equal((activityStrip([],today).match(/class="has-activity"/g)||[]).length,0);
});
