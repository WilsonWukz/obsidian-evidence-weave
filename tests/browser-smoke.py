"""Chromium DOM/UI smoke: simulated native Graph renderer, not Obsidian 1.14.4."""
from pathlib import Path
import shutil
import os
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent.parent
CHROME=shutil.which('chromium') or shutil.which('google-chrome') or None
compiled=(root/'main.js').read_text()
css=(root/'styles.css').read_text()
fixture="""
window.module={exports:{}};
class FakePlugin {addChild(){} removeChild(){} async saveData(){} }
class FakeComponent {load(){} unload(){} }
class FakeNotice {constructor(text){window.lastNotice=text;}}
window.require=function(name){if(name!=='obsidian')throw Error(name);return {
Plugin:FakePlugin,PluginSettingTab:class{},Setting:class{},Notice:FakeNotice,
Component:FakeComponent,parseYaml:s=>Object.fromEntries(s.split('\\n').filter(l=>l.includes(':')).map(l=>l.split(':'))),
MarkdownRenderer:{render:async(app,md,body)=>{const n=document.createElement('div');n.className='pdf-embed';n.style.cssText='overflow-y:auto;height:100%;width:100%;';n.innerHTML=Array.from({length:100},(_,i)=>'<p>Simulated PDF page '+(i+1)+'</p>').join('');body.append(n);}}
};};
"""
setup="""
const srcPath='INSES/C00-INSES.md',targetPath='INSES/P21-Dense-X-Retrieval.md';
const host=document.querySelector('#graph');
const file={path:targetPath,basename:'P21-Dense-X-Retrieval',extension:'md'};
const nodes=[{id:'C00',path:srcPath,basename:'C00-INSES',kind:'center',file:{path:srcPath}},
{id:'P21',path:targetPath,basename:'P21-Dense-X-Retrieval',kind:'paper',title:'Dense X Retrieval',file,
pdfPath:'attachments/p21.pdf',pdfUrl:null}];
const r1={id:srcPath,x:150,y:180,weight:2},r2={id:targetPath,x:420,y:280,weight:2};
window.renderer={containerEl:host,nodeLookup:{[srcPath]:r1,[targetPath]:r2},links:[{source:r1,target:r2}],
highlightNode:r2,scale:1,panX:0,panY:0,nodeScale:1,changed(){this.changedCount=(this.changedCount||0)+1;},
onNodeClick(){this.nativeCalls=(this.nativeCalls||0)+1;},getHighlightNode(){return this.highlightNode;}};
const md='- [[P21-Dense-X-Retrieval#^R-P21-01|P21]]：本来完整长关系说明，不应该被改写。 状态：有限关系已审。\\n';
window.mdSource=md;
const app={vault:{cachedRead:async f=>window.mdSource,getAbstractFileByPath:()=>({path:'INSES/M00-关系总览.md',extension:'md'}),
 process:async(f,fn)=>{window.mdSource=fn(window.mdSource)}},metadataCache:{getFirstLinkpathDest:()=>({path:'attachments/p21.pdf',extension:'pdf'})}};
window.plugin={app,settings:{projectFolder:'INSES',overviewPath:'INSES/M00-关系总览.md',pdfWidth:495,pdfHeight:810,
rememberPdfSize:true},isScopedPath:path=>path.startsWith('INSES/'),model:{nodes,edges:[{
id:'R-P21-01',kind:'overview',source:'C00',target:'P21',labelFromSource:'以其说明检索粒度',labelFromTarget:'',
summaryFromSource:'本来完整长关系说明，不应该被改写。',summaryFromTarget:'被引用',
labelStatus:'reviewed',storage:{kind:'overview',note:'INSES/M00-关系总览.md',sourceLine:md.trimEnd()}}]},
addChild(){},removeChild(){},async saveData(){},async refreshModel(){window.binding.onModelUpdated()}};
window.binding=new window.module.exports._test.NativeGraphBinding(window.plugin,{view:{getViewType:()=> 'graph'}},window.renderer);
window.binding.attach();window.binding.pointerInGraph=true;
window.renderer.highlightNode=r2;
"""
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=CHROME,args=['--no-sandbox','--disable-dev-shm-usage'] if CHROME else [])
 page=browser.new_page(viewport={'width':1280,'height':960})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content('<html><body style="margin:0"><div id="graph" style="position:relative;width:1220px;height:945px; background:#fafafa;overflow:hidden"></div></body></html>')
 page.add_style_tag(content=css)
 page.add_script_tag(content=fixture)
 page.add_script_tag(content=compiled)
 page.evaluate(setup)
 page.wait_for_timeout(500)
 print('hover node',page.evaluate('window.binding.focusPath'),'pdf visible',page.locator('.ew-native-pdf').is_visible())
 print('labels',page.locator('.ew-native-edge-label').count())
 assert page.locator('.ew-native-pdf').is_visible()
 assert page.locator('.ew-native-edge-label').count()==1
 state=page.evaluate('''() =>({left:window.binding.popup.style.left,top:window.binding.popup.style.top,transform:window.binding.popup.style.transform})''')
 page.evaluate('''() =>{window.renderer.scale=1.6;window.renderer.panX=65;window.renderer.panY=35;window.renderer.nodeLookup['INSES/P21-Dense-X-Retrieval.md'].x+=45}''')
 page.wait_for_timeout(130)
 after=page.evaluate('''() =>({left:window.binding.popup.style.left,top:window.binding.popup.style.top,transform:window.binding.popup.style.transform})''')
 assert state['transform']!=after['transform']
 assert state['left']!=after['left'] and state['top']!=after['top']
 print('canvas zoom:',state,'=>',after)
 page.evaluate("window.renderer.onNodeClick({button:0},'INSES/P21-Dense-X-Retrieval.md','file')")
 page.evaluate('window.renderer.highlightNode=null')
 page.wait_for_timeout(440)
 assert page.evaluate('window.binding.focusPath')=='INSES/P21-Dense-X-Retrieval.md'
 print('locked',page.evaluate('window.binding.lockedPath'))
 # Zoom back so the bottom-right handle is inside the viewport. World-space
 # panel remains full-size and pan/zoom is reversible.
 page.evaluate('''() => {window.renderer.scale=1;window.renderer.panX=0;window.renderer.panY=0}''')
 page.wait_for_timeout(150)
 # Drag using the PDF *header*, not the graph or one of its resize corners.
 # Pointer capture must keep the drag working across the PDF iframe.
 window_before=page.evaluate('''() => ({
   x:window.binding.pdfWorld.x,y:window.binding.pdfWorld.y,
   width:window.binding.pdfBaseSize.width,height:window.binding.pdfBaseSize.height,
   reader:document.querySelector('.pdf-embed'),
   nodeX:window.renderer.nodeLookup['INSES/P21-Dense-X-Retrieval.md'].x,
   nativeCalls:window.renderer.nativeCalls||0})''')
 header=page.locator('.ew-native-pdf-header')
 header_box=header.bounding_box(); assert header_box
 start_x=header_box['x']+min(110,header_box['width']*.2)
 start_y=header_box['y']+header_box['height']*.5
 page.mouse.move(start_x,start_y)
 page.mouse.down()
 page.mouse.move(start_x+85,start_y+45,steps=9)
 page.mouse.up()
 page.wait_for_timeout(110)
 window_after=page.evaluate('''() => ({
   x:window.binding.pdfWorld.x,y:window.binding.pdfWorld.y,
   width:window.binding.pdfBaseSize.width,height:window.binding.pdfBaseSize.height,
   reader:document.querySelector('.pdf-embed'),
   nodeX:window.renderer.nodeLookup['INSES/P21-Dense-X-Retrieval.md'].x,
   nativeCalls:window.renderer.nativeCalls||0})''')
 assert abs((window_after['x']-window_before['x'])-85)<2,(window_before,window_after)
 assert abs((window_after['y']-window_before['y'])-45)<2,(window_before,window_after)
 assert window_after['width']==window_before['width'] and window_after['height']==window_before['height']
 assert window_after['nodeX']==window_before['nodeX']
 assert window_after['nativeCalls']==window_before['nativeCalls']
 assert page.evaluate('document.querySelector(".pdf-embed")==window.binding.popup.querySelector(".pdf-embed")')
 assert page.evaluate('window.binding.lockedPath')=='INSES/P21-Dense-X-Retrieval.md'
 print('header drag preserves PDF size, reader, original graph node and lock')
 # Even after moving manually, graph zoom must continue to transform the PDF.
 page.evaluate('''() => {window.renderer.scale=1.3;window.renderer.panX=25;window.renderer.panY=30}''')
 page.wait_for_timeout(130)
 assert page.evaluate('window.binding.popup.style.transform')=='scale(1.3)'
 page.evaluate('''() => {window.renderer.scale=1;window.renderer.panX=0;window.renderer.panY=0}''')
 page.wait_for_timeout(140)
 # Clicking a PDF toolbar action must not move the window.
 pos_before_action=page.evaluate('''() => ({...window.binding.pdfWorld})''')
 page.locator('.ew-native-pdf-action[title="在外部打开完整 PDF"]').evaluate('el=>el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:47}))')
 assert page.evaluate('window.binding.drag===null')
 assert page.evaluate('''() => JSON.stringify(window.binding.pdfWorld)''')==__import__('json').dumps(pos_before_action,separators=(',',':'))
 # The manually moved 810px-high reader can place its lower-right corner
 # outside the viewport; zoom OUT first, as the real graph permits.
 page.evaluate('''() => {window.renderer.scale=.70;window.renderer.panX=0;window.renderer.panY=0}''')
 page.wait_for_timeout(120)
 # Resize via browser pointer interface while transformed
 box=page.locator('.ew-resize-se').bounding_box()
 assert box, 'bottom-right handle should be visible'
 page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
 page.mouse.down();page.mouse.move(box['x']+85,box['y']+130,steps=8);page.mouse.up()
 size=page.evaluate('''() => ({w:window.binding.pdfBaseSize.width,h:window.binding.pdfBaseSize.height})''')
 print('resize:',size)
 assert size['w']>495 and size['h']>810
 # Scroll once through a long synthetic PDF and retain the reader across edits
 beforeReader=page.locator('.pdf-embed').evaluate('(el)=>{el.scrollTop=el.scrollHeight;return el.scrollTop}')
 assert beforeReader>0
 page.evaluate('window.pdfReaderRef=document.querySelector(".pdf-embed")')
 # Text edit uses separate short label
 page.locator('.ew-native-edge-label').click(force=True)
 page.locator('.ew-native-edge-editor').fill('更新的关系短句')
 page.locator('.ew-native-edge-editor').press('Enter')
 page.wait_for_timeout(160)
 md=page.evaluate('window.mdSource')
 print('notice',page.evaluate('window.lastNotice'),'editorExists',page.locator('.ew-native-edge-editor').count(),'md',repr(md))
 assert '本来完整长关系说明，不应该被改写。' in md
 assert '图谱反向短句' in md
 print('saved short',md.strip())
 assert page.evaluate('document.querySelector(".pdf-embed")===window.pdfReaderRef')
 assert page.locator('.pdf-embed').evaluate('(el)=>el.scrollTop')==beforeReader
 print('PDF reader instance/scroll retained after note edit')
 assert not errors,errors
 page.screenshot(path=os.environ.get('EW_SMOKE_SCREENSHOT',str(root/'browser-smoke.png')),full_page=True)
 print('Browser smoke PASS')
 browser.close()
