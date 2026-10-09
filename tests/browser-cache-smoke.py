from pathlib import Path
import base64
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
source=(root/'main.js').read_text()
# Synthetic data only, generated at test time; no copyrighted PDF shipped.
import io,shutil
from reportlab.pdfgen import canvas
stream=io.BytesIO(); c=canvas.Canvas(stream)
for i in range(1,51):
 c.drawString(65,750,f'Fixture page {i} of 50');c.showPage()
c.save();fixture=stream.getvalue()
CHROME=shutil.which('chromium') or shutil.which('google-chrome') or None
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=CHROME,args=['--no-sandbox','--disable-dev-shm-usage'] if CHROME else [])
 page=browser.new_page(viewport={'width':1250,'height':930})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<div id="graph" style="position:relative;width:1200px;height:920px"></div>')
 page.add_style_tag(content=(root/'styles.css').read_text())
 page.add_script_tag(content="""
 window.module={exports:{}};
 window.require=function(n){if(n!=='obsidian')throw Error('wrong module');return {
 Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class {constructor(msg){window.notice=msg}},
 Component:class{},MarkdownRenderer:{render:async()=>{}},parseYaml:s=>({}),
 requestUrl:async()=>({arrayBuffer:window.__pdfBytes})
 };};
 """)
 page.add_script_tag(content=source)
 pdfbase64=base64.b64encode(fixture).decode()
 page.evaluate('''b64=>{const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);window.__pdfBytes=bytes.buffer}''',pdfbase64)
 page.evaluate('''() => {
 const path='INSES/P21-Paper.md',node={id:path,x:220,y:160,weight:2};
 window.r={containerEl:document.querySelector('#graph'),nodeLookup:{[path]:node},links:[],highlightNode:node,
 scale:1,panX:0,panY:0,nodeScale:1,onNodeClick(){},getHighlightNode(){return this.highlightNode},changed(){}};
 const f={path,extension:'md'};
 const m={path,kind:'paper',file:f,title:'Synthetic 50-page PDF',pdfPath:'',pdfUrl:'https://example.org/long.pdf'};
 const plugin={model:{nodes:[m],edges:[]},settings:{projectFolder:'INSES',overviewPath:'INSES/M00-关系总览.md',pdfWidth:495,pdfHeight:810,rememberPdfSize:true},
 isScopedPath:()=>true,app:{vault:{cachedRead:async()=>'PDF URL:https://example.org/long.pdf'}},addChild(){},removeChild(){}};
 window.binding=new module.exports._test.NativeGraphBinding(plugin,{view:{getViewType:()=> 'graph'}},r);
 window.binding.attach();window.binding.pointerInGraph=true;window.binding.lock(path);
 }''')
 page.wait_for_timeout(800)
 assert page.locator('.ew-native-pdf').is_visible()
 assert page.locator('.ew-native-pdf-frame').count()==1
 page.locator('.ew-native-pdf-action[title^="尝试将整份"]').click()
 page.wait_for_timeout(700)
 status=page.locator('.ew-native-pdf-status').inner_text()
 iframe=page.locator('.ew-native-pdf-frame').get_attribute('src')
 assert iframe.startswith('blob:'),(status,iframe)
 assert '完整下载' in status,status
 print('50-page PDF loaded to verified in-memory blob, iframe source:',iframe[:40]);print(status)
 assert not errors,errors
 page.evaluate('window.binding.unlock()')
 page.wait_for_timeout(250)
 assert page.evaluate('window.binding.pdfObjectUrl===null')
 print('Blob URL released; browser-cache-smoke PASS')
 browser.close()
