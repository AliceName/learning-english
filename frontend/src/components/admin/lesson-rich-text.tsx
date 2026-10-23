"use client";
import {useId,useState,type ReactNode} from "react";
import {lessonBlocks} from "@/lib/lesson-text";
import type {Reading} from "@/lib/admin-courses";
import styles from "./admin.module.css";

type Vocabulary=Reading["vocabulary"];
function GlossaryTerm({word,item}:{word:string;item:Vocabulary[number]}) {
  const [open,setOpen]=useState(false);
  const id=useId();
  return <span className={styles.glossaryTerm}><button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>{word}</button>{open&&<span id={id} className={styles.glossaryMeaning}><strong>{item.meaning}</strong>{item.example&&<span>{item.example}</span>}</span>}</span>;
}
function glossaryText(text:string,vocabulary:Vocabulary):ReactNode {
  const entries=vocabulary.filter(item=>item.word.trim()&&item.meaning.trim());
  if(!entries.length)return text;
  const words=entries.map(item=>item.word.trim()).sort((a,b)=>b.length-a.length).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const pattern=new RegExp(`(?<![\\p{L}\\p{N}])(${words.join("|")})(?![\\p{L}\\p{N}])`,"giu");
  return text.split(pattern).map((part,index)=>{
    const entry=entries.find(item=>item.word.trim().toLowerCase()===part.toLowerCase());
    return entry?<GlossaryTerm key={index} word={part} item={entry}/>:part;
  });
}
function inline(text:string,vocabulary:Vocabulary,depth=0):ReactNode {
  if(depth>4)return glossaryText(text,vocabulary);
  const pattern=/(\*\*([^\n]+?)\*\*|\+\+([^\n]+?)\+\+|==([^\n]+?)==|`([^`\n]+)`|\*([^*\n]+?)\*)/g;
  const nodes:ReactNode[]=[];
  let end=0;
  for(const match of text.matchAll(pattern)) {
    nodes.push(glossaryText(text.slice(end,match.index),vocabulary));
    const child=inline(match[2]??match[3]??match[4]??match[5]??match[6],vocabulary,depth+1);
    nodes.push(match[2]?<strong key={match.index}>{child}</strong>:match[3]?<u key={match.index}>{child}</u>:match[4]?<mark key={match.index}>{child}</mark>:match[5]?<code key={match.index}>{child}</code>:<em key={match.index}>{child}</em>);
    end=match.index+match[0].length;
  }
  nodes.push(glossaryText(text.slice(end),vocabulary));
  return nodes;
}
export default function LessonRichText({text,vocabulary=[]}:{text:string;vocabulary?:Vocabulary}) {
  return <div className={styles.lessonRichText}>{lessonBlocks(text).map((block,index)=>{
    if(block.kind==="ul"||block.kind==="ol") {
      const Tag=block.kind;
      return <Tag key={index}>{block.lines.map((line,lineIndex)=><li key={lineIndex}>{inline(line,vocabulary)}</li>)}</Tag>;
    }
    const Tag=block.kind==="paragraph"?"p":block.kind==="quote"?"blockquote":block.kind;
    return <Tag key={index}>{inline(block.lines.join("\n"),vocabulary)}</Tag>;
  })}</div>;
}
