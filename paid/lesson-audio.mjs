// Device speech synthesis. No microphone, audio recording, or listening telemetry.
export function lessonText(lesson,scope='full'){
 const essentials=[lesson.title,'Exam essentials.',...lesson.essentials];
 if(scope==='essentials')return essentials.join('\n');
 const d=lesson.advanced;
 return [...essentials,...lesson.sections.flat(),...(d?.sections.flat()||[]),
 'Compare the concepts.',...(d?.compare.flatMap(([term,meaning,limit])=>[term,meaning,limit])||[]),
 'Decision steps.',...lesson.steps,'Worked example.',lesson.example,
 ...(d?['Challenge scenario.',d.case.situation,d.case.question,'Worked reasoning.',d.case.reasoning,'Why alternatives fail.',d.case.alternatives]:[]),
 'Common mistakes.',...lesson.traps,
 'Self-check questions. Stop the audio to consider your answers. Reveal the reasoning on the page when ready.',
 lesson.question,...(d?.checks.map(([q])=>q)||[])].join('\n');
}
export function speechChunks(text,max=240){
 const sentences=String(text).trim().split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
 return sentences.flatMap(sentence=>{const parts=[];let chunk='';for(const word of sentence.trim().split(/\s+/)){if(chunk&&chunk.length+word.length+1>max){parts.push(chunk);chunk='';}chunk+=(chunk?' ':'')+word;}if(chunk)parts.push(chunk);return parts;});
}
export class LessonReader{
 constructor(synth,Utterance,onState=()=>{},schedule=fn=>fn()){this.schedule=schedule;this.synth=synth;this.Utterance=Utterance;this.onState=onState;this.run=0;this.state='idle';this.index=0;this.chunks=[];}
 emit(state){this.state=state;this.onState({state,index:this.index,total:this.chunks.length});}
 play(text,{voice=null,rate=1}={}){this.stop();this.chunks=speechChunks(text);this.index=0;this.voice=voice;this.rate=rate;if(!this.chunks.length)return;this.emit('playing');this.next(this.run);}
 next(run){if(run!==this.run||this.state!=='playing')return;if(this.index>=this.chunks.length){this.emit('complete');return;}
  const u=new this.Utterance(this.chunks[this.index]);this.current=u;u.lang=this.voice?.lang||'en-US';if(this.voice)u.voice=this.voice;u.rate=this.rate;
  u.onend=()=>{if(run!==this.run||this.current!==u||this.state!=='playing')return;this.index++;this.emit('playing');this.schedule(()=>this.next(run));};
  u.onerror=()=>{if(run!==this.run||this.current!==u)return;this.run++;this.synth.cancel();this.emit('error');};
  try{this.synth.speak(u);}catch{if(run===this.run){this.run++;this.synth.cancel();this.emit('error');}}
 }
 // Cancelling at pause avoids browsers that cannot reliably resume long utterances.
 // Resume repeats only the current short passage; completed passages are preserved.
 pause(){if(this.state!=='playing')return;this.run++;this.current=null;this.synth.cancel();this.emit('paused');}
 resume(){if(this.state!=='paused')return;this.emit('playing');this.next(this.run);}
 stop(){this.run++;this.current=null;this.synth.cancel();this.emit('idle');}
}
export function mountLessonAudio(root,lesson,env=globalThis){
 const panel=root.querySelector('[data-lesson-audio]');if(!panel)return()=>{};
 const status=panel.querySelector('[data-audio-status]'),play=panel.querySelector('[data-audio-play]'),pause=panel.querySelector('[data-audio-pause]'),stop=panel.querySelector('[data-audio-stop]'),voiceSelect=panel.querySelector('[data-audio-voice]'),scope=panel.querySelector('[data-audio-scope]'),rate=panel.querySelector('[data-audio-rate]');
 if(!env.speechSynthesis||!env.SpeechSynthesisUtterance){status.textContent='Read aloud is unavailable in this browser. Lesson text remains available to your screen reader. Try a supported browser or your device’s reading feature.';panel.querySelectorAll('button,select').forEach(el=>el.disabled=true);return()=>{};}
 let voices=[],disposed=false;const synth=env.speechSynthesis;
 const reader=new LessonReader(synth,env.SpeechSynthesisUtterance,({state,index,total})=>{
  if(disposed)return;play.textContent=state==='paused'?'Resume reading':state==='playing'?'Restart reading':'Listen to lesson';pause.disabled=state!=='playing';stop.disabled=!['playing','paused'].includes(state);voiceSelect.disabled=scope.disabled=rate.disabled=['playing','paused'].includes(state);
  const message=state==='playing'?'Reading. Use Pause or Stop to control playback.':state==='paused'?'Paused. Resume may repeat the current short passage.':state==='complete'?'Reading complete.':state==='error'?'The voice could not read this lesson. Try another voice or use your device’s screen reader.':'Ready to listen.';
  if(status.textContent!==message)status.textContent=message;
 },fn=>env.setTimeout(fn,50));
 function refreshVoices(){if(disposed)return;const selected=voices[Number(voiceSelect.value)]?.voiceURI;voices=synth.getVoices().filter(v=>/^en(?:-|$)/i.test(v.lang)).sort((a,b)=>Number(b.localService)-Number(a.localService));voiceSelect.replaceChildren();const def=env.document.createElement('option');def.value='';def.textContent='Device default voice (processing depends on device)';voiceSelect.append(def);voices.forEach((v,i)=>{const option=env.document.createElement('option');option.value=String(i);option.textContent=`${v.name} · ${v.lang} · ${v.localService?'on-device':'online provider'}`;voiceSelect.append(option);});const previous=voices.findIndex(v=>v.voiceURI===selected);const local=voices.findIndex(v=>v.localService);voiceSelect.value=previous>=0?String(previous):local>=0?String(local):'';}
 function click(e){const b=e.target.closest('button');if(!b)return;e.stopPropagation();if(b===play){if(reader.state==='paused')reader.resume();else reader.play(lessonText(lesson,scope.value),{voice:voiceSelect.value===''?null:voices[Number(voiceSelect.value)],rate:Number(rate.value)});}else if(b===pause)reader.pause();else if(b===stop)reader.stop();}
 panel.addEventListener('click',click);synth.addEventListener?.('voiceschanged',refreshVoices);refreshVoices();pause.disabled=true;stop.disabled=true;
 const observer=new env.MutationObserver(()=>{if(!panel.isConnected)dispose();});observer.observe(root,{childList:true});
 function dispose(){if(disposed)return;reader.stop();disposed=true;observer.disconnect();panel.removeEventListener('click',click);synth.removeEventListener?.('voiceschanged',refreshVoices);env.removeEventListener('pagehide',dispose);}
 env.addEventListener('pagehide',dispose);return dispose;
}
