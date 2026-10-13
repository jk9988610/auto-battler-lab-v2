(function(){
var myUid=null;
var _lastStateKey='';
var _lastLine={};
var gameOverLocked=false;
var lastRankings=[];
var autoConnectTried=false;
var rejoinInFlight=false;

var DARK_CSS = [
  "body{background:#0d0d0f !important;color:#e6e6e6 !important;font-family:system-ui,sans-serif;}",
  "h1{color:#c8a15a !important;letter-spacing:1px;}",
  "fieldset{background:#17171a !important;border:1px solid #2d2d33 !important;border-radius:10px !important;box-shadow:0 0 0 1px #0a0a0c inset;}",
  "legend{color:#c8a15a !important;font-weight:600;padding:0 6px;}",
  "input,textarea{background:#0a0a0c !important;color:#e6e6e6 !important;border:1px solid #2d2d33 !important;border-radius:6px !important;outline:none;}",
  "input:focus,textarea:focus{border-color:#c8a15a !important;box-shadow:0 0 0 2px rgba(200,161,90,0.15);}",
  "button{background:#1c1c20 !important;color:#e6e6e6 !important;border:1px solid #33333a !important;border-radius:6px !important;cursor:pointer;transition:background .12s,border-color .12s;}",
  "button:hover{background:#2a2a30 !important;border-color:#c8a15a !important;}",
  "button:disabled{opacity:.45 !important;cursor:not-allowed !important;border-color:#222 !important;}",
  "#log{background:#050507 !important;color:#7fd67f !important;border:1px solid #1e1e22 !important;box-shadow:0 0 12px rgba(0,0,0,0.6) inset;}",
  ".room-item{background:#17171a !important;border:1px solid #2d2d33 !important;color:#e6e6e6 !important;}",
  ".seat{background:#17171a !important;border:1px solid #2d2d33 !important;color:#e6e6e6 !important;}",
  ".seat.me{background:#12200f !important;border-color:#3d7d3d !important;}",
  ".seat.host{border-color:#c8a15a !important;}",
  ".seat.empty{color:#555 !important;}",
  ".tag{background:#2a2a30 !important;color:#aaa !important;}",
  ".tag.ready{background:#173017 !important;color:#7fd67f !important;}",
  "#view-game{background:transparent !important;}"
].join("");

function injectDark(){
  if(document.getElementById('ab-dark'))return;
  var s=document.createElement('style');
  s.id='ab-dark';
  s.textContent=DARK_CSS;
  document.head.appendChild(s);
}

function trace(tag,msg,data){
  if(tag==='recv'){
    if(msg==='room:list'||msg==='room:update'||msg==='game:state'||msg==='hello')return;
  }
  var key=tag+'|'+msg;
  var line='['+tag+'] '+msg;
  if(data!==undefined){
    try{ line += ' ' + JSON.stringify(data); }catch(e){ line += ' [unser]'; }
  }
  if(_lastLine[key]===line)return;
  _lastLine[key]=line;
  if(typeof window.log==='function'){
    var cls = (tag==='err')?'err':'ok';
    window.log(line, cls);
  }
  try{ console.log(line); }catch(e){}
}

function getMyUid(){
  if(window.me && window.me.uid!=null) return window.me.uid;
  return myUid;
}

function upgradeCostFor(tier){
  var table = {1:5, 2:7, 3:8, 4:9, 5:10};
  return table[tier] || 0;
}

function inject(){
  if(document.getElementById('view-game'))return;
  var logEl=document.getElementById('log');
  if(!logEl)return;
  var d=document.createElement('div');
  d.id='view-game';
  d.className='hidden';
  d.style.border='1px solid #c8a15a';
  d.style.borderRadius='10px';
  d.style.padding='4px';
  d.style.background='#101013';
  d.innerHTML='<fieldset><legend>对局</legend>'
    +'<div>房间: <b id="gRoom">-</b></div>'
    +'<div>回合: <b id="gTurn">1</b></div>'
    +'<div>阶段: <b id="gPhase">准备</b></div>'
    +'<div>我的金币: <b id="gGold">3</b> / 血量: <b id="gHp">40</b> / 酒馆等级: <b id="gTier">1</b></div>'
    +'<hr style="border-color:#2d2d33"/>'
    +'<div><b>我的场上</b>（最多7，战斗只用场上的卡）</div>'
    +'<div id="gBoard"></div>'
    +'<hr style="border-color:#2d2d33"/>'
    +'<div><b>我的商店</b>（每张3金） <button onclick="doRefresh()">刷新(1金)</button> <button id="btnFreeze" onclick="doFreeze()">冻结</button> <button id="btnUpgrade" onclick="doUpgrade()">升级酒馆</button> <button onclick="doDebugTriple()">三连测试</button></div>'
    +'<div id="gShop"></div>'
    +'<hr style="border-color:#2d2d33"/>'
    +'<div><b>我的手牌</b>（上阵/出售，3张同名同星合成金色）</div>'
    +'<div id="gHand"></div>'
    +'<hr style="border-color:#2d2d33"/>'
    +'<div><b>所有玩家</b></div>'
    +'<div id="gPlayers"></div>'
    +'<hr style="border-color:#2d2d33"/>'
    +'<div><b>战斗结果</b></div>'
    +'<div id="gBattle" style="color:#bbb">（暂无）</div>'
    +'<div id="gRank" style="color:#c8a15a;margin-top:8px"></div>'
    +'<div id="gOver" style="margin-top:10px"></div>'
    +'<button id="gBtnEnd" onclick="endTurn()">结束回合</button>'
    +'<button onclick="backToLobby()">返回大厅</button>'
    +'</fieldset>';
  logEl.parentNode.insertBefore(d,logEl);
}

function enterGame(){
  var ids=['view-auth','view-lobby','view-room'];
  ids.forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.className='hidden';
  });
  var g=document.getElementById('view-game');
  if(g)g.className='';
  window.scrollTo(0,0);
}

function makeCardEl(card, actions){
  var div=document.createElement('div');
  var isGolden=!!card.golden;
  div.style.border=isGolden?'2px solid #f5c542':'1px solid #33333a';
  div.style.padding='8px';
  div.style.margin='4px';
  div.style.display='inline-block';
  div.style.minWidth='120px';
  div.style.background=isGolden?'linear-gradient(180deg,#2a220e,#17171a)':'#17171a';
  div.style.borderRadius='8px';
  div.style.verticalAlign='top';
  div.style.boxShadow=isGolden?'0 0 10px rgba(245,197,66,0.35)':'0 2px 6px rgba(0,0,0,0.4)';
  var name=document.createElement('div');
  name.textContent=card.name;
  name.style.fontWeight='bold';
  name.style.color=isGolden?'#f5c542':'#e6e6e6';
  var stats=document.createElement('div');
  stats.textContent='攻'+card.attack+' 血'+card.hp;
  stats.style.color=isGolden?'#ffd76a':'#c8a15a';
  var tier=document.createElement('div');
  tier.textContent='★'.repeat(card.tier||1)+(isGolden?' ✦':'');
  tier.style.color=isGolden?'#ffd76a':'#c8a15a';
  div.appendChild(name);
  div.appendChild(stats);
  div.appendChild(tier);
  if(card.keywords && card.keywords.length>0){
    var kw=document.createElement('div');
    kw.textContent=card.keywords.map(function(k){return '['+k+']';}).join(' ');
    kw.style.color='#8cf';
    kw.style.fontSize='11px';
    kw.style.marginTop='2px';
    div.appendChild(kw);
  }
  if(actions && actions.length){
    var btnRow=document.createElement('div');
    btnRow.style.marginTop='6px';
    actions.forEach(function(a){
      var b=document.createElement('button');
      b.textContent=a.label;
      b.onclick=a.fn;
      b.style.marginRight='4px';
      btnRow.appendChild(b);
    });
    div.appendChild(btnRow);
  }
  return div;
}

function renderState(state){
  if(!state)return;
  document.getElementById('gRoom').textContent=state.roomId;
  document.getElementById('gTurn').textContent=String(state.turn);
  document.getElementById('gPhase').textContent=state.phase==='prepare'?'准备':(state.phase==='combat'?'战斗':'结束');

  var uid=getMyUid();
  var me=null;
  if(uid!=null){
    state.players.forEach(function(p){ if(p.uid===uid)me=p; });
  }
  if(!me && state.players.length===1) me=state.players[0];

  document.getElementById('gGold').textContent=me?String(me.gold):'-';
  document.getElementById('gHp').textContent=me?String(me.hp):'-';
  document.getElementById('gTier').textContent=me?String(me.tavernTier||1):'-';

  var btnUp = document.getElementById('btnUpgrade');
  if(btnUp && me){
    var tier = me.tavernTier||1;
    if(tier >= 6){
      btnUp.textContent = '已满级';
      btnUp.disabled = true;
    } else {
      var cost = upgradeCostFor(tier);
      btnUp.textContent = '升级酒馆(到' + (tier+1) + '级 ' + cost + '金)';
      btnUp.disabled = me.gold < cost;
    }
  }

  var boardBox=document.getElementById('gBoard');
  boardBox.innerHTML='';
  if(me&&me.board&&me.board.length>0){
    me.board.forEach(function(card,idx){
      boardBox.appendChild(makeCardEl(card,[{
        label:'下阵',
        fn:(function(i){return function(){doRemove(i);};})(idx)
      }]));
    });
  } else if(me){
    boardBox.textContent='（空）手牌点「上阵」放到这里';
    boardBox.style.color='#666';
  }

  var shopBox=document.getElementById('gShop');
  shopBox.innerHTML='';
  if(me&&me.alive===false){
    shopBox.textContent='你已被淘汰';
    shopBox.style.color='#c66';
  } else if(me&&me.shop&&me.shop.length>0){
    me.shop.forEach(function(card,idx){
      shopBox.appendChild(makeCardEl(card,[{
        label:'购买 3金',
        fn:(function(i){return function(){doBuy(i);};})(idx)
      }]));
    });
  } else if(me){
    shopBox.textContent='商店为空（点击刷新）';
    shopBox.style.color='#666';
  } else {
    shopBox.textContent='(找不到你的玩家数据 uid='+uid+')';
    shopBox.style.color='#c66';
  }

  var handBox=document.getElementById('gHand');
  handBox.innerHTML='';
  if(me&&me.hand&&me.hand.length>0){
    me.hand.forEach(function(card,idx){
      handBox.appendChild(makeCardEl(card,[
        {label:'上阵',fn:(function(i){return function(){doPlace(i);};})(idx)},
        {label:'出售 +1金',fn:(function(i){return function(){doSell(i);};})(idx)}
      ]));
    });
  } else if(me){
    handBox.textContent='（空）';
    handBox.style.color='#666';
  }

  var freezeBtn=document.getElementById('btnFreeze');
  if(freezeBtn&&me){
    freezeBtn.textContent=me.frozen?'解冻':'冻结';
    freezeBtn.style.background=me.frozen?'#3a2f12':'';
    freezeBtn.style.borderColor=me.frozen?'#c8a15a':'';
  }

  var box=document.getElementById('gPlayers');
  box.innerHTML='';
  state.players.forEach(function(p){
    var row=document.createElement('div');
    row.style.padding='4px 0';
    row.style.borderBottom='1px dashed #222';
    var status=p.alive===false?'[淘汰]':(p.ready?'[已结束]':'[行动中]');
    var goldCount=0;
    (p.hand||[]).forEach(function(c){ if(c.golden)goldCount+=1; });
    var boardN=(p.board||[]).length;
    var tags='T'+(p.tavernTier||1)+' 金币:'+p.gold+' 血量:'+p.hp+' 场上:'+boardN+' 手牌:'+(p.hand?p.hand.length:0)+(goldCount>0?' 金卡'+goldCount:'')+' '+status;
    row.textContent=p.username+'  '+tags;
    if(p.alive===false)row.style.color='#666';
    if(uid!=null&&p.uid===uid){row.style.fontWeight='bold';if(p.alive!==false)row.style.color='#c8a15a';}
    box.appendChild(row);
  });

  var meReady=me?(me.ready||me.alive===false):false;
  var btn=document.getElementById('gBtnEnd');
  if(btn){
    var over=state.phase==='over';
    btn.textContent=over?'对局已结束':(meReady?'已结束 等其他人':'结束回合');
    btn.disabled=meReady||over;
  }

  var stateKey=state.turn+'|'+state.phase+'|'+state.players.map(function(p){
    var handKey=(p.hand||[]).map(function(c){return c.name+(c.golden?'g':'');}).join('.');
    var boardKey=(p.board||[]).map(function(c){return c.name+(c.golden?'g':'');}).join('.');
    return p.uid+':'+(p.tavernTier||1)+':'+p.gold+':'+p.hp+':H['+handKey+']:B['+boardKey+']:'+(p.ready?1:0)+':'+(p.alive?1:0);
  }).join(',');
  if(stateKey!==_lastStateKey){
    _lastStateKey=stateKey;
    var summary=state.players.map(function(p){
      var goldCount=0;
      (p.hand||[]).forEach(function(c){ if(c.golden)goldCount+=1; });
      return p.username+' T'+(p.tavernTier||1)+' 金'+p.gold+' 血'+p.hp+' 场'+(p.board?p.board.length:0)+' 手'+(p.hand?p.hand.length:0)+(goldCount>0?' 金卡'+goldCount:'')+(p.ready?' ✓':'')+(p.alive===false?' ✗淘汰':'');
    }).join(' | ');
    trace('state','T'+state.turn+' '+state.phase+'  '+summary);
  }
}

function renderBattle(battle){
  var el=document.getElementById('gBattle');
  el.innerHTML='';
  el.style.color='#bbb';
  if(!battle){el.textContent='（暂无）';return;}
  var head=document.createElement('div');
  head.textContent='第 '+battle.turn+' 回合结算';
  head.style.color='#c8a15a';
  head.style.fontWeight='bold';
  el.appendChild(head);

  battle.pairings.forEach(function(pr){
    var myUidLocal=getMyUid();
    var isMyPair=(myUidLocal!=null && (pr.aUid===myUidLocal||pr.bUid===myUidLocal));
    var block=document.createElement('div');
    block.style.margin='8px 0';
    block.style.padding='8px';
    block.style.border='1px solid #33333a';
    block.style.borderRadius='6px';
    block.style.background=isMyPair?'#151a12':'#101013';

    var winnerName=pr.winnerUid===pr.aUid?pr.aName:pr.bName;
    var loserName=pr.winnerUid===pr.aUid?pr.bName:pr.aName;
    var title=document.createElement('div');
    title.textContent=winnerName+' 胜 · 对 '+loserName+' 造成 '+pr.damage+' 伤害';
    title.style.fontWeight='bold';
    title.style.color=isMyPair?'#c8a15a':'#888';
    title.style.marginBottom='6px';
    title.style.fontSize='13px';
    block.appendChild(title);

    var rowBox=document.createElement('div');
    rowBox.style.display='flex';
    rowBox.style.gap='10px';
    rowBox.style.alignItems='stretch';

    function sideBox(name, power, cards, isWinner, isMine){
      var box=document.createElement('div');
      box.style.flex='1';
      box.style.minWidth='0';
      box.style.padding='4px';
      if(isMine){ box.style.boxShadow='0 0 0 2px #3d7d3d'; box.style.borderRadius='4px'; }
      var head=document.createElement('div');
      head.textContent=name+' ('+power+')'+(isWinner?' 胜':'');
      head.style.fontWeight='bold';
      head.style.color=isWinner?'#f5c542':'#aaa';
      head.style.marginBottom='4px';
      head.style.fontSize='12px';
      box.appendChild(head);
      if(!cards||cards.length===0){
        var empty=document.createElement('div');
        empty.textContent='空场';
        empty.style.color='#555';
        empty.style.fontSize='11px';
        box.appendChild(empty);
      } else {
        cards.forEach(function(c){
          var card=document.createElement('span');
          var g=c.golden?' *':'';
          card.textContent=c.name+g+' '+c.attack+'/'+c.hp;
          card.style.display='inline-block';
          card.style.padding='2px 5px';
          card.style.margin='2px';
          card.style.borderRadius='4px';
          card.style.fontSize='11px';
          card.style.border=c.golden?'2px solid #f5c542':'1px solid #444';
          card.style.background=c.golden?'#2a220e':'#1a1a1d';
          card.style.color=c.golden?'#ffd76a':'#ccc';
          box.appendChild(card);
        });
      }
      return box;
    }

    rowBox.appendChild(sideBox(pr.aName, pr.aPower, pr.aSurvivors||[], pr.winnerUid===pr.aUid, myUidLocal===pr.aUid));
    var vs=document.createElement('div');
    vs.textContent='VS';
    vs.style.color='#c8a15a';
    vs.style.fontWeight='bold';
    vs.style.alignSelf='center';
    vs.style.fontSize='12px';
    rowBox.appendChild(vs);
    rowBox.appendChild(sideBox(pr.bName, pr.bPower, pr.bSurvivors||[], pr.winnerUid===pr.bUid, myUidLocal===pr.bUid));
    block.appendChild(rowBox);
    if(pr.battleLog && pr.battleLog.length>0){
      var logBox=document.createElement('details');
      logBox.style.marginTop='6px';
      logBox.style.fontSize='11px';
      var sum=document.createElement('summary');
      sum.textContent='战报 ('+pr.battleLog.length+' 条)';
      sum.style.cursor='pointer';
      sum.style.color='#888';
      logBox.appendChild(sum);
      pr.battleLog.forEach(function(line){
        var row=document.createElement('div');
        row.textContent=line;
        row.style.padding='1px 0';
        row.style.color='#999';
        if(/阵亡/.test(line)) row.style.color='#c66';
        logBox.appendChild(row);
      });
      box.appendChild(logBox);
    }
    el.appendChild(block);
  });

  if(battle.eliminated&&battle.eliminated.length>0){
    var elim=document.createElement('div');
    elim.style.color='#c66';
    elim.style.marginTop='6px';
    elim.textContent='淘汰: '+battle.eliminated.map(function(x){return x.username;}).join(', ');
    el.appendChild(elim);
  }
  battle.pairings.forEach(function(pr){
    var line='[battle] T'+battle.turn+' '+pr.aName+'('+pr.aPower+') vs '+pr.bName+'('+pr.bPower+') -> '+((pr.winnerUid===pr.aUid)?pr.aName:pr.bName)+' 胜 -'+pr.damage;
    if(typeof window.log==='function')window.log(line,'');
  });
  if(battle.eliminated&&battle.eliminated.length>0){
    if(typeof window.log==='function')window.log('[battle] 淘汰: '+battle.eliminated.map(function(x){return x.username;}).join(','),'err');
  }
}

function renderRank(rankings){
  var el=document.getElementById('gRank');
  el.innerHTML='';
  if(!rankings||rankings.length===0)return;
  lastRankings=rankings;
  var t=document.createElement('div');
  t.textContent='最终排名';
  t.style.fontWeight='bold';
  el.appendChild(t);
  rankings.forEach(function(r){
    var row=document.createElement('div');
    row.textContent='#'+r.rank+'  '+r.username;
    if(r.rank===1)row.style.color='#ffd76a';
    el.appendChild(row);
  });
  if(typeof window.log==='function'){
    window.log('[rank] '+rankings.map(function(r){return '#'+r.rank+' '+r.username;}).join('  '),'ok');
  }
}

function showGameOver(){
  var el=document.getElementById('gOver');
  if(!el)return;
  el.innerHTML='';
  var tip=document.createElement('div');
  tip.textContent='对局已结束。房主可以在房间页重新开局，其他玩家稍等。';
  tip.style.color='#c8a15a';
  tip.style.marginBottom='6px';
  el.appendChild(tip);
  var btn=document.createElement('button');
  btn.textContent='返回房间';
  btn.onclick=function(){
    gameOverLocked=false;
    if(typeof window.show==='function')window.show('room');
    if(typeof window.loadRooms==='function')window.loadRooms();
  };
  el.appendChild(btn);
}

function clearGameOver(){
  var el=document.getElementById('gOver');
  if(el)el.innerHTML='';
}

function patchShow(){
  if(typeof window.show!=='function')return;
  if(window.show.__ab15)return;
  var orig=window.show;
  window.show=function(v){
    if(gameOverLocked && v!=='game'){
      orig('game');
      return;
    }
    orig(v);
    if(v==='game'){enterGame();return;}
    var g=document.getElementById('view-game');
    if(g)g.className='hidden';
  };
  window.show.__ab15=true;
}

function tryAutoConnect(){
  if(autoConnectTried)return;
  if(!sessionStorage.getItem("token"))return;
  if(window.socket)return;
  autoConnectTried=true;
  if(typeof window.doConnect==='function'){
    trace('init','检测到 token，自动重连...','');
    window.doConnect();
  }
}

function doRejoin(){
  if(rejoinInFlight)return;
  if(!window.socket)return;
  rejoinInFlight=true;
  window.socket.emit('room:rejoin', function(res){
    rejoinInFlight=false;
    if(res && res.ok && res.room){
      if(typeof window.log==='function'){
        window.log('[rejoin] 已恢复房间 ' + res.room.id + (res.hasGame ? ' (对局进行中)' : ''),'ok');
      }
      if(res.hasGame){
        // 服务端也会 emit game:state，会触发 enterGame
        enterGame();
      } else {
        if(typeof window.show==='function')window.show('room');
      }
    } else {
      if(typeof window.log==='function')window.log('[rejoin] 未找到房间','');
      if(typeof window.show==='function')window.show('lobby');
      if(typeof window.loadRooms==='function')window.loadRooms();
    }
  });
}

function patchSocket(){
  if(!window.socket)return;
  if(window.socket.__ab15)return;
  window.socket.__ab15=true;

  window.socket.on('connect', function(){
    trace('init','socket connected','');
    // 延迟 300ms，让 index.html 的 connect 处理先跑（show lobby / loadRooms）
    setTimeout(doRejoin, 300);
  });

  window.socket.on('hello',function(data){
    if(data&&data.user)myUid=data.user.uid;
  });
  window.socket.on('room:started',function(data){
    gameOverLocked=false;
    clearGameOver();
    _lastStateKey='';
    enterGame();
    if(typeof window.log==='function')window.log('[room] 开局 '+data.roomId,'ok');
  });
  window.socket.on('game:state',function(state){
    enterGame();
    renderState(state);
    if(state&&state.phase==='over'&&state.rankings){
      renderRank(state.rankings);
    }
  });
  window.socket.on('game:battle',function(battle){ renderBattle(battle); });
  window.socket.on('game:triple',function(data){
    if(typeof window.log==='function'){
      window.log('[triple] '+data.username+' 合成了 '+data.name+'（攻'+data.attack+' 血'+data.hp+'）','ok');
    }
  });
  window.socket.on('game:upgraded',function(data){
    if(typeof window.log==='function'){
      window.log('[upgrade] '+data.username+' 升级到酒馆 T'+data.newTier+'（花费 '+data.cost+' 金）','ok');
    }
  });
  window.socket.on('game:finished',function(data){
    gameOverLocked=true;
    showGameOver();
    enterGame();
    if(typeof window.log==='function')window.log('[game] 对局结束 房间已重置','ok');
  });
  window.socket.on('game:closed',function(){
    gameOverLocked=false;
    clearGameOver();
    if(typeof window.log==='function')window.log('对局已关闭');
    window.show('lobby');
  });
}

function loop(){
  injectDark();
  inject();
  patchShow();
  patchSocket();
  tryAutoConnect();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loop);
else loop();
setInterval(loop,300);

function emitGame(event,payload){
  if(!window.socket){console.warn('[game-panel] no socket');return;}
  var cb=function(res){
    if(typeof window.log!=='function')return;
    if(!res||!res.ok){
      window.log(event+' 失败: '+(res&&res.error),'err');
    }
  };
  if(payload===undefined){ window.socket.emit(event,cb); }
  else { window.socket.emit(event,payload,cb); }
}

window.doBuy=function(slot){ emitGame('game:buy',{slot:slot}); };
window.doSell=function(handIndex){ emitGame('game:sell',{handIndex:handIndex}); };
window.doPlace=function(handIndex){ emitGame('game:place',{handIndex:handIndex}); };
window.doRemove=function(boardIndex){ emitGame('game:remove',{boardIndex:boardIndex}); };
window.doRefresh=function(){ emitGame('game:refresh'); };
window.doFreeze=function(){ emitGame('game:freeze'); };
window.doUpgrade=function(){ emitGame('game:upgrade'); };
window.endTurn=function(){ emitGame('game:endTurn'); };
window.doDebugTriple=function(){ emitGame('game:debug-triple'); };

window.backToLobby=function(){
  gameOverLocked=false;
  if(window.socket)window.socket.emit('room:leave');
  window.currentRoom=null;
  if(typeof window.show==='function')window.show('lobby');
  if(typeof window.loadRooms==='function')window.loadRooms();
};
})();