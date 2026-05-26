import React, { useState, useRef, useEffect } from 'react';

const TABS = ['홈', '채팅', '이벤트', '설정'];
const C = { primary:'#2A5F7F', pl:'#4A8FB8', bg:'#F8F9FA', card:'#FFF', text:'#2C3E50', tl:'#7F8C9A', border:'#E9ECEF', success:'#06D6A0', warning:'#F4A261', danger:'#EF476F' };

export default function HomeCareApp() {
  const [tab, setTab] = useState(0);
  return (
    <div style={{ maxWidth:430, margin:'0 auto', minHeight:'100vh', background:C.bg, position:'relative', fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ display:'flex', background:C.card, borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:10 }}>
        {TABS.map((t,i) => <div key={t} onClick={()=>setTab(i)} style={{ flex:1, padding:'16px 12px', textAlign:'center', fontSize:14, fontWeight:600, color:tab===i?C.primary:C.tl, borderBottom:`3px solid ${tab===i?C.primary:'transparent'}`, cursor:'pointer' }}>{t}</div>)}
      </div>
      <div style={{ paddingBottom:80 }}>
        {tab===0 && <HomeScreen/>}
        {tab===1 && <ChatScreen/>}
        {tab===2 && <EventsScreen/>}
        {tab===3 && <SettingsScreen/>}
      </div>
      <div style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:430, height:70, background:C.card, borderTop:`1px solid ${C.border}`, display:'flex', paddingBottom:8 }}>
        {[{i:'🏠',l:'홈'},{i:'💬',l:'채팅'},{i:'📋',l:'이벤트'},{i:'⚙️',l:'설정'}].map((x,idx)=>
          <div key={idx} onClick={()=>setTab(idx)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2, cursor:'pointer' }}>
            <span style={{ fontSize:22 }}>{x.i}</span>
            <span style={{ fontSize:11, fontWeight:600, color:tab===idx?C.primary:C.tl }}>{x.l}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HomeScreen() {
  const cards = [{icon:'📷',label:'카메라',value:'2대 온라인',bg:'#D4F4E7'},{icon:'📊',label:'오늘 이벤트',value:'5건',bg:'#D1E7F8'},{icon:'⚠️',label:'위험 알림',value:'0건',bg:'#FFE8D1'},{icon:'✅',label:'시스템 상태',value:'정상',bg:'#D4F4E7'}];
  const events = [{icon:'🚪',title:'방문자 감지',desc:'현관 앞에서 택배 기사 감지',time:'10분 전 • 현관 카메라',bg:'#D1E7F8'},{icon:'🚶',title:'움직임 감지',desc:'거실에서 활동 감지',time:'1시간 전 • 거실 카메라',bg:'#D4F4E7'},{icon:'🔔',title:'소리 감지',desc:'초인종 소리 감지',time:'3시간 전 • 현관 센서',bg:'#FFE8D1'}];
  return (
    <div>
      <div style={{ background:`linear-gradient(135deg,${C.primary},${C.pl})`, padding:'24px 20px 32px', color:'#fff' }}>
        <div style={{ fontSize:28, fontWeight:700, marginBottom:8 }}>안녕하세요 👋</div>
        <div style={{ fontSize:15, opacity:0.9 }}>부모님 집 상태를 확인하세요</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, padding:20, marginTop:-20 }}>
        {cards.map((c,i)=><div key={i} style={{ background:C.card, borderRadius:16, padding:18, boxShadow:'0 2px 12px rgba(42,95,127,0.08)' }}>
          <div style={{ width:40,height:40,borderRadius:12,background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,marginBottom:12 }}>{c.icon}</div>
          <div style={{ fontSize:13,color:C.tl,marginBottom:6 }}>{c.label}</div>
          <div style={{ fontSize:20,fontWeight:700,color:C.text }}>{c.value}</div>
        </div>)}
      </div>
      <div style={{ fontSize:18,fontWeight:700,color:C.text,padding:'0 20px',margin:'24px 0 12px' }}>최근 이벤트</div>
      <div style={{ padding:'0 20px' }}>
        {events.map((e,i)=><div key={i} style={{ background:C.card,borderRadius:16,padding:16,marginBottom:12,boxShadow:'0 2px 8px rgba(42,95,127,0.08)',display:'flex',gap:14 }}>
          <div style={{ width:48,height:48,borderRadius:12,background:e.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0 }}>{e.icon}</div>
          <div><div style={{ fontSize:15,fontWeight:600,color:C.text,marginBottom:4 }}>{e.title}</div><div style={{ fontSize:13,color:C.tl,marginBottom:6 }}>{e.desc}</div><div style={{ fontSize:12,color:C.tl }}>{e.time}</div></div>
        </div>)}
      </div>
    </div>
  );
}

function ChatScreen() {
  const [messages, setMessages] = useState([
    {role:'ai',text:'안녕하세요! HOME-TALK AI입니다.\n부모님 집에 대해 무엇이든 물어보세요.',time:'오전 9:30'},
    {role:'user',text:'오늘 방문자 알려줘',time:'오전 9:41'},
    {role:'ai',text:'오늘 오전 10시 30분에 현관에서 택배 기사가 감지됐어요. 소포를 문 앞에 두고 갔습니다. 신뢰도는 92%입니다.',time:'오전 9:41'},
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}); },[messages]);

  const getTime = () => { const d=new Date(); return `${d.getHours()>=12?'오후':'오전'} ${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')}`; };

  const send = (text) => {
    const msg = text || input.trim();
    if(!msg || loading) return;
    const t = getTime();
    setMessages(p=>[...p,{role:'user',text:msg,time:t}]);
    setInput('');
    setLoading(true);
    setTimeout(()=>{
      let reply = '';
      if(msg.includes('방문자')||msg.includes('누가')) reply='오늘 총 2명의 방문자가 있었어요.\n\n1. 오전 10:30 — 택배 기사 (신뢰도 92%)\n2. 오후 3:00 — 가족 귀가 (신뢰도 95%)';
      else if(msg.includes('위험')||msg.includes('안전')) reply='오늘은 위험 이벤트가 0건입니다. 안심하셔도 됩니다 ✅';
      else if(msg.includes('카메라')||msg.includes('상태')) reply='📷 현관 카메라 — 온라인 ✅\n📷 거실 카메라 — 온라인 ✅';
      else if(msg.includes('요약')) reply='📊 전체: 5건\n🚪 방문자: 2회\n🚶 움직임: 2회\n🔔 소리: 1회\n🚨 위험: 0건\n\n평온한 하루였습니다.';
      else reply=`"${msg}" 확인 중... 데모 모드입니다. Claude API 연동 후 실제 DB 조회가 가능합니다.`;
      setMessages(p=>[...p,{role:'ai',text:reply,time:t}]);
      setLoading(false);
    },1200);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 130px)' }}>
      <div style={{ background:C.card,padding:'14px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:12,flexShrink:0 }}>
        <div style={{ width:42,height:42,borderRadius:14,background:`linear-gradient(135deg,${C.primary},${C.pl})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:22 }}>🤖</div>
        <div><div style={{ fontSize:16,fontWeight:700,color:C.text }}>HOME-TALK AI</div><div style={{ fontSize:13,color:C.success }}>● 온라인</div></div>
      </div>

      <div style={{ flex:1,overflowY:'auto',padding:'16px 16px 8px' }}>
        {messages.map((m,i)=>(
          <div key={i} style={{ display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',marginBottom:14 }}>
            {m.role==='ai'&&<div style={{ width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${C.primary},${C.pl})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12,marginRight:8,flexShrink:0,marginTop:2 }}>🤖</div>}
            <div style={{ maxWidth:'75%',padding:'12px 16px',borderRadius:18,fontSize:14,lineHeight:1.6,whiteSpace:'pre-wrap',...(m.role==='user'?{background:C.primary,color:'#fff',borderBottomRightRadius:6}:{background:C.card,color:C.text,boxShadow:'0 2px 8px rgba(42,95,127,0.08)',borderBottomLeftRadius:6}) }}>
              {m.text}
              <div style={{ fontSize:11,marginTop:6,opacity:0.5 }}>{m.time}</div>
            </div>
          </div>
        ))}
        {loading&&<div style={{ display:'flex',gap:8,marginBottom:14 }}>
          <div style={{ width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${C.primary},${C.pl})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12 }}>🤖</div>
          <div style={{ background:C.card,padding:'14px 20px',borderRadius:18,borderBottomLeftRadius:6,boxShadow:'0 2px 8px rgba(42,95,127,0.08)' }}>
            <div style={{ display:'flex',gap:5 }}>{[0,0.2,0.4].map((d,i)=><div key={i} style={{ width:8,height:8,borderRadius:'50%',background:C.tl,animation:'bounce 1.4s infinite ease-in-out',animationDelay:`${d}s` }}/>)}</div>
          </div>
        </div>}
        <div ref={endRef}/>
      </div>

      <div style={{ padding:'8px 16px',display:'flex',gap:8,overflowX:'auto',flexShrink:0 }}>
        {['오늘 요약','방문자 확인','위험 알림','카메라 상태'].map((a,i)=>
          <button key={i} onClick={()=>send(a)} style={{ padding:'8px 14px',borderRadius:20,background:C.card,border:`1px solid ${C.border}`,fontSize:13,color:C.text,cursor:'pointer',whiteSpace:'nowrap' }}>{a}</button>
        )}
      </div>

      <div style={{ padding:'10px 16px 16px',background:C.card,borderTop:`1px solid ${C.border}`,display:'flex',gap:10,alignItems:'flex-end',flexShrink:0 }}>
        <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="메시지를 입력하세요..." rows={1}
          style={{ flex:1,padding:'12px 16px',borderRadius:24,border:`2px solid ${C.border}`,fontSize:15,color:C.text,resize:'none',outline:'none',fontFamily:'inherit',lineHeight:1.4,maxHeight:100 }}
          onFocus={e=>e.target.style.borderColor=C.primary} onBlur={e=>e.target.style.borderColor=C.border}
        />
        <button onClick={()=>send()} disabled={!input.trim()||loading}
          style={{ width:46,height:46,borderRadius:'50%',border:'none',background:input.trim()&&!loading?C.primary:C.border,color:'#fff',fontSize:20,cursor:input.trim()&&!loading?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
          ↑
        </button>
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

function EventsScreen() {
  const [filter,setFilter]=useState('전체');
  const all=[
    {icon:'🚪',title:'방문자 감지',desc:'현관 앞 방문자 (신뢰도: 92%)',time:'2026-05-19 10:30',type:'방문자',bg:'#D1E7F8'},
    {icon:'🚶',title:'움직임 감지',desc:'거실 움직임 (신뢰도: 85%)',time:'2026-05-19 09:15',type:'움직임',bg:'#D4F4E7'},
    {icon:'🔔',title:'소리 감지',desc:'초인종 소리 (신뢰도: 88%)',time:'2026-05-19 07:00',type:'소리',bg:'#FFE8D1'},
    {icon:'🚨',title:'위험 감지',desc:'유리 파손 (신뢰도: 92%)',time:'2026-05-18 22:30',type:'위험',bg:'#FFD6E0'},
    {icon:'🚪',title:'방문자 감지',desc:'가족 귀가 (신뢰도: 95%)',time:'2026-05-18 17:00',type:'방문자',bg:'#D1E7F8'},
  ];
  const filtered=filter==='전체'?all:all.filter(e=>e.type===filter);
  return (
    <div>
      <div style={{ display:'flex',padding:'16px 20px',gap:8,overflowX:'auto',background:C.card,borderBottom:`1px solid ${C.border}` }}>
        {['전체','방문자','움직임','소리','위험'].map(f=><div key={f} onClick={()=>setFilter(f)} style={{ padding:'8px 16px',borderRadius:20,background:filter===f?C.primary:C.bg,fontSize:13,fontWeight:600,color:filter===f?'#fff':C.text,cursor:'pointer',whiteSpace:'nowrap' }}>{f}</div>)}
      </div>
      <div style={{ padding:'20px 20px 0' }}>
        {filtered.map((e,i)=><div key={i} style={{ background:C.card,borderRadius:16,padding:16,marginBottom:12,boxShadow:'0 2px 8px rgba(42,95,127,0.08)',display:'flex',gap:14 }}>
          <div style={{ width:48,height:48,borderRadius:12,background:e.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0 }}>{e.icon}</div>
          <div><div style={{ fontSize:15,fontWeight:600,color:C.text,marginBottom:4 }}>{e.title}</div><div style={{ fontSize:13,color:C.tl,marginBottom:6 }}>{e.desc}</div><div style={{ fontSize:12,color:C.tl }}>{e.time}</div></div>
        </div>)}
      </div>
    </div>
  );
}

function SettingsScreen() {
  const [tg,setTg]=useState({danger:true,visitor:true,motion:false,sound:true,brief:true});
  const Toggle=({on,onClick})=><div onClick={onClick} style={{ width:48,height:28,borderRadius:14,background:on?C.success:'#CBD5E1',cursor:'pointer',position:'relative',flexShrink:0 }}><div style={{ position:'absolute',top:3,left:on?23:3,width:22,height:22,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.2)',transition:'left .3s' }}/></div>;
  const Item=({icon,bg,title,desc,right,onClick})=><div onClick={onClick} style={{ padding:'16px 18px',display:'flex',alignItems:'center',gap:14,borderBottom:`1px solid ${C.border}`,cursor:onClick?'pointer':'default' }}>
    <div style={{ width:36,height:36,borderRadius:10,background:bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0 }}>{icon}</div>
    <div style={{ flex:1 }}><div style={{ fontSize:15,fontWeight:600,color:C.text }}>{title}</div>{desc&&<div style={{ fontSize:12,color:C.tl,marginTop:2 }}>{desc}</div>}</div>{right}
  </div>;
  const Sec=({title,children})=><div style={{ padding:'0 20px',marginBottom:20 }}><div style={{ fontSize:13,fontWeight:700,color:C.tl,letterSpacing:.5,marginBottom:10,paddingLeft:4 }}>{title}</div><div style={{ background:C.card,borderRadius:16,boxShadow:'0 2px 8px rgba(42,95,127,0.08)',overflow:'hidden' }}>{children}</div></div>;
  return (
    <div>
      <div style={{ background:`linear-gradient(135deg,${C.primary},${C.pl})`,padding:'24px 20px 28px',color:'#fff' }}><div style={{ fontSize:24,fontWeight:700,marginBottom:4 }}>설정</div><div style={{ fontSize:14,opacity:.85 }}>HOME-TALK 앱 환경설정</div></div>
      <div style={{ background:C.card,borderRadius:16,padding:20,margin:'-16px 20px 16px',boxShadow:'0 4px 16px rgba(42,95,127,0.08)',display:'flex',alignItems:'center',gap:16 }}>
        <div style={{ width:56,height:56,borderRadius:'50%',background:`linear-gradient(135deg,${C.primary},${C.pl})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:24,fontWeight:700 }}>양</div>
        <div style={{ flex:1 }}><div style={{ fontSize:17,fontWeight:700,color:C.text }}>양소희</div><div style={{ fontSize:13,color:C.tl }}>soheei@home-talk.kr</div><span style={{ padding:'4px 10px',borderRadius:12,background:'#D4F4E7',color:C.success,fontSize:11,fontWeight:700,marginTop:4,display:'inline-block' }}>✅ 로그인됨</span></div>
        <span style={{ color:C.tl }}>›</span>
      </div>
      <Sec title="🔔 알림 설정">
        <Item icon="🚨" bg="#FFD6E0" title="위험 알림" desc="낙상, 화재, 유리 파손" right={<Toggle on={tg.danger} onClick={()=>setTg(p=>({...p,danger:!p.danger}))}/>}/>
        <Item icon="🚪" bg="#D1E7F8" title="방문자 알림" desc="사람 감지 시 Push 알림" right={<Toggle on={tg.visitor} onClick={()=>setTg(p=>({...p,visitor:!p.visitor}))}/>}/>
        <Item icon="🚶" bg="#D4F4E7" title="움직임 알림" desc="활동 감지 시 알림" right={<Toggle on={tg.motion} onClick={()=>setTg(p=>({...p,motion:!p.motion}))}/>}/>
        <Item icon="🔔" bg="#FFE8D1" title="소리 알림" desc="초인종, 아기 울음 등" right={<Toggle on={tg.sound} onClick={()=>setTg(p=>({...p,sound:!p.sound}))}/>}/>
        <Item icon="📊" bg="#E8DEF8" title="일일 브리핑" desc="매일 오후 9시 AI 요약" right={<Toggle on={tg.brief} onClick={()=>setTg(p=>({...p,brief:!p.brief}))}/>}/>
      </Sec>
      <Sec title="👤 계정">
        <Item icon="🔑" bg="#D1E7F8" title="로그인 관리" desc="Supabase Auth" right={<span style={{color:C.tl}}>›</span>} onClick={()=>{}}/>
        <Item icon="🔒" bg="#D4F4E7" title="보안 설정" desc="비밀번호 변경, 2단계 인증" right={<span style={{color:C.tl}}>›</span>} onClick={()=>{}}/>
        <Item icon="📱" bg="#FFE8D1" title="연결된 디바이스" desc="카메라 2대" right={<span style={{color:C.tl}}>›</span>} onClick={()=>{}}/>
      </Sec>
      <Sec title="👨‍👩‍👧‍👦 가족 공유">
        {[{n:'양소희 (나)',r:'관리자',init:'양',g:`${C.primary},${C.pl}`,s:'온라인',sc:C.success},{n:'김태훈',r:'멤버 • 조회+알림',init:'김',g:'#F4A261,#E76F51',s:'온라인',sc:C.success},{n:'엄마',r:'멤버 • 조회만',init:'엄',g:'#06D6A0,#118AB2',s:'오프라인',sc:C.tl}].map((m,i)=>
          <div key={i} style={{ display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderBottom:i<2?`1px solid ${C.border}`:'none' }}>
            <div style={{ width:40,height:40,borderRadius:'50%',background:`linear-gradient(135deg,${m.g})`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:16,fontWeight:700 }}>{m.init}</div>
            <div style={{ flex:1 }}><div style={{ fontSize:14,fontWeight:600,color:C.text }}>{m.n}</div><div style={{ fontSize:12,color:C.tl }}>{m.r}</div></div>
            <span style={{ fontSize:12,fontWeight:600,color:m.sc }}>{m.s}</span>
          </div>
        )}
      </Sec>
      <div style={{ padding:'0 20px',marginBottom:30 }}>
        <button style={{ width:'100%',padding:14,border:`2px dashed ${C.border}`,borderRadius:12,background:'none',color:C.primary,fontSize:14,fontWeight:600,cursor:'pointer' }}>+ 가족 초대하기</button>
      </div>
    </div>
  );
}
