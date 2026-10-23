export type TextBlock={kind:"paragraph"|"h2"|"h3"|"quote"|"ul"|"ol";lines:string[]};

// The lesson format is a small Markdown subset. HTML, links and embeds stay text.
export function lessonBlocks(text:string):TextBlock[] {
  const blocks:TextBlock[]=[];
  let separated=true;
  for(const line of text.replaceAll("\r\n","\n").split("\n")) {
    if(!line.trim()){separated=true;continue;}
    const match=/^(#{2,3})\s+(.+)$|^>\s?(.*)$|^[-*]\s+(.+)$|^\d+\.\s+(.+)$/.exec(line);
    const kind:TextBlock["kind"]=match?.[1]?(match[1]==="##"?"h2":"h3"):match?.[3]!==undefined?"quote":match?.[4]!==undefined?"ul":match?.[5]!==undefined?"ol":"paragraph";
    const content=match?(match[2]??match[3]??match[4]??match[5]):line;
    const previous=blocks.at(-1);
    if(!separated&&previous?.kind===kind&&kind!=="h2"&&kind!=="h3")previous.lines.push(content);
    else blocks.push({kind,lines:[content]});
    separated=false;
  }
  return blocks;
}

export function readingParagraphCount(text:string):number {
  return lessonBlocks(text).filter(block=>block.kind!=="h2"&&block.kind!=="h3").length;
}

export function lessonPlainText(text:string):string {
  return lessonBlocks(text).map(block=>block.lines.join("\n")).join("\n\n").replace(/\*\*|\+\+|==|`|\*/g,"");
}

export type TextFormat="normal"|"h2"|"h3"|"bold"|"italic"|"underline"|"bullet"|"number"|"quote"|"highlight";
export function formatLessonText(text:string,start:number,end:number,format:TextFormat) {
  const wrappers={bold:"**",italic:"*",underline:"++",highlight:"=="};
  if(format in wrappers) {
    const marker=wrappers[format as keyof typeof wrappers];
    const selection=text.slice(start,end)||"nội dung";
    const inserted=`${marker}${selection}${marker}`;
    return {text:text.slice(0,start)+inserted+text.slice(end),start:start+marker.length,end:start+marker.length+selection.length};
  }
  const from=start===0?0:text.lastIndexOf("\n",start-1)+1;
  const next=text.indexOf("\n",end);
  const to=next===-1?text.length:next;
  const lines=text.slice(from,to).split("\n").map((line,index)=>{
    const clean=line.replace(/^(?:#{2,3}\s+|>\s?|[-*]\s+|\d+\.\s+)/,"");
    const prefix=format==="h2"?"## ":format==="h3"?"### ":format==="bullet"?"- ":format==="number"?`${index+1}. `:format==="quote"?"> ":"";
    return prefix+clean;
  }).join("\n");
  return {text:text.slice(0,from)+lines+text.slice(to),start:from,end:from+lines.length};
}
