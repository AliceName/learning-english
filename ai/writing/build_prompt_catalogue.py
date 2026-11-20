"""Build the private Writing task library (ai/writing/data/prompt-catalogue.v1.json).

The 50 prompts come from YOUR OWN licensed copy of the Cambridge Write & Improve 2024 corpus
(whole-corpus/en-writeandimprove2024-prompts-info.tsv); prompt text is never stored in Git.
This file only holds the Vietnamese titles and self-check requirements written for LEWA
(agent-reviewed, not expert-validated). Output is byte-identical for the same source file,
so task ids and versions match on every machine.

Usage (from ai/writing):
  .venv/Scripts/python.exe build_prompt_catalogue.py --source <corpus>/whole-corpus/en-writeandimprove2024-prompts-info.tsv
"""
import argparse, csv, hashlib, json, os, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ai/writing'))
from prepare_verified_corpus import strict_decode

SOURCE = Path(os.getenv('WI_PROMPTS_INFO', str(Path.home() / 'Downloads/write-and-improve-corpus-2024-v2/whole-corpus/en-writeandimprove2024-prompts-info.tsv')))
TARGET = ROOT / 'ai/writing/data/prompt-catalogue.v1.json'
EXPECTED_SOURCE_SHA256 = '880a0e29c9160395d1dfccf69da696758d1b11e2e23b264304781723b82878d4'
# Reviewed against all 50 full prompts. These are self-checks, not reference labels.
CURATION = '''Sinh nhật ở quê bạn|Kể cách tổ chức sinh nhật ở đất nước bạn.|So sánh với sinh nhật của người bạn trong thư.
Năm học mới|Viết cho Matt.|Nêu việc bạn sẽ làm để cải thiện tiếng Anh trong năm học mới.
Mục tiêu năm học|Viết báo cáo cho giáo viên.|Nêu phần học tập bạn hài lòng, phần muốn cải thiện và cách đạt mục tiêu.
Thời gian rảnh|Nêu hoạt động và tần suất.|Giải thích điều bạn thích và lý do.|Kể lần gần nhất làm hoạt động đó.
Lỡ buổi tiệc|Viết lời nhắn cho Leyla.|Nêu lý do không đến được.|Hỏi chuyện buổi tiệc và rủ làm một việc vào cuối tuần tới.
Học với các giáo viên khác nhau|Chọn học cùng giáo viên nhiều năm hoặc đổi giáo viên.|Đưa lý do cụ thể bảo vệ lựa chọn.
Tập thể dục|Nêu mức độ yêu thích và tần suất tập.|Chọn tập trong phòng gym hoặc ngoài trời và giải thích.|Kể các hoạt động tập luyện bạn thích.
Không dự tiệc được|Viết email cho Alex.|Xin lỗi và giải thích vì sao không đến được.|Đề nghị một ngày khác để gặp.
Bộ phim yêu thích — email ngắn|Kể loại phim và nội dung.|Cho biết bạn mình có thích phim không.
Trẻ em và trò chơi điện tử|Nêu quan điểm về trẻ em chơi trò chơi điện tử.|Dùng lý do và ví dụ cụ thể.
Chỗ ở khi học đại học|Chọn sống riêng xa nhà hoặc sống cùng gia đình.|Giải thích lựa chọn bằng lý do.
Bác sĩ ở nông thôn|Nêu nguyên nhân thiếu bác sĩ ở vùng nông thôn.|Đề xuất cách giải quyết.
Vì sao học tiếng Anh|Viết email trả lời Ana.|Giải thích vì sao học tiếng Anh quan trọng với bạn.
Tập thể dục và sức khỏe|Trả lời có điều gì quan trọng hơn tập thể dục với sức khỏe không.|Viết bài thể hiện quan điểm.
Sống lâu hay sống mãnh liệt|Chọn cuộc đời dài bình lặng hoặc ngắn nhưng mãnh liệt.|Giải thích lý do.
Du học|Trình bày ưu điểm và nhược điểm của học ở nước ngoài.
Quan điểm về sở thú|Nêu quan điểm về việc giữ động vật trong sở thú.|Giải thích bằng lý do cụ thể.
Món ăn đặc biệt|Viết cho một học sinh ở nước khác.|Nêu món ăn, lúc thường ăn và lý do thích.|Viết ít nhất một đoạn, thêm chi tiết.
Thiết kế văn phòng|Chọn văn phòng ngăn ô hoặc không gian mở.|Giải thích lựa chọn bằng lý do.
Thói quen ngủ|Viết ít nhất hai đoạn.|Nêu cách bạn thích ngủ và giải thích.
Truyền hình có giáo dục không|Nêu quan điểm liệu truyền hình ngoài giải trí còn có thể giáo dục.
Học âm nhạc ở trường|Nêu quan điểm có nên bắt buộc mọi học sinh học âm nhạc.|Dùng lý do và ví dụ hỗ trợ.
Yêu cầu làm tình nguyện|Nêu quan điểm về yêu cầu làm tình nguyện để tốt nghiệp.|Dùng chi tiết hỗ trợ.
Cấm điện thoại nơi công cộng|Viết thư cho hội đồng thị trấn.|Nêu quan điểm về lệnh cấm điện thoại trên phương tiện công cộng, trong cửa hàng và nhà hàng.|Giải thích lý do.
Sử dụng máy tính|Nêu tần suất dùng và mục đích.|Kể hoạt động bạn thích làm nhất với máy tính.
Chuyến đi cùng lớp|Viết email cho Billal.|Nêu nơi đã đi, việc đã làm và lý do thích chuyến đi.
Giúp người bạn bị tai nạn|Viết lời nhắn cho Cristina.|Bày tỏ sự tiếc nuối, nêu cách giúp và lúc có thể đến thăm.
Lời mời ăn tối|Viết lời nhắn cho Rie.|Xác nhận có thể đến ăn tối và nói món bạn thích.
Lý do học tiếng Anh|Viết bài cho tạp chí trường.|Mô tả lý do học tiếng Anh và vì sao quan trọng với bạn.
Hoạt động trong nhà|Nêu hoạt động trong nhà yêu thích và lý do.|Kể lần gần nhất làm hoạt động đó.
Nói thật hay nói dối|Nêu quan điểm có khi nào nói dối chấp nhận được không.|Dùng lý do và ví dụ cụ thể.
Nhờ hàng xóm trông nhà|Viết lời nhắn hướng dẫn hàng xóm làm gì khi bạn đi nghỉ.|Chìa khóa, cây, thú cưng, thư từ là ví dụ để lựa chọn; không bắt buộc đủ bốn.
Đi bảo tàng khoa học|Viết email cho Chris.|Nêu cách đi, điều có thể xem và đồ cần mang.
Kỳ nghỉ đáng nhớ nhất|Kể nơi đã đến và điều đã thấy.|Giải thích vì sao là kỳ nghỉ tuyệt nhất.
Sức khỏe hay sự giàu có|Viết bài nêu quan điểm về nhận định khỏe mạnh quan trọng hơn giàu có.
Tầm quan trọng của ngoại ngữ|Nêu quan điểm việc học nói ngoại ngữ hiện nay có quan trọng như trước không.
Âm nhạc trong cuộc sống|Viết bài cho tạp chí âm nhạc với văn phong phù hợp.|Nêu khi nào âm nhạc quan trọng, cảm xúc nó mang lại và cuộc sống nếu thiếu âm nhạc.
Tương lai của du lịch|Viết bài cho tạp chí.|Nêu điều có thể thay đổi và điều có thể giữ nguyên trong tương lai.
Bạn đến thăm nhà|Viết email cho Sam.|Nêu giờ đến, đồ cần mang và cách đến nhà.
Bạn làm gì khi rảnh|Viết cho giáo viên.|Nêu những việc làm lúc rảnh và khi nào làm các việc đó.
Bộ phim yêu thích — thư giới thiệu|Viết thư cho bạn qua thư.|Giải thích vì sao thích phim và vì sao bạn ấy nên xem.
Trải nghiệm Write and Improve|Viết báo cáo cho giáo viên.|Nêu điều thích hoặc không thích và lý do.|Kết thúc bằng việc có khuyên bạn cùng lớp thử không.
Mùa yêu thích|Viết bài cho tạp chí trường.|Mô tả mùa yêu thích và giải thích vì sao đặc biệt.
Ngôi trường tương lai|Viết bài cho tạp chí.|Nêu điều có thể khác và điều có thể giữ nguyên ở trường trong tương lai.
Học một môn mới|Viết lời nhắn cho giáo viên.|Nêu môn muốn học, lý do và thời gian muốn học.|Nhờ giáo viên giúp.
Giới thiệu quê hương|Viết một đoạn cho tờ giới thiệu quê hương.|Chọn HAI trong BỐN nhóm: địa danh; mua sắm và chỗ ở; công viên, bảo tàng và nhà hàng; giải trí ban đêm. Không bắt buộc cả bốn.
Bắt buộc người trẻ chơi thể thao|Viết bài nghị luận.|Nêu có đồng ý bắt buộc sinh viên và học sinh chơi thể thao ít nhất ba lần mỗi tuần không.
Sách và công nghệ|Viết bài nêu quan điểm máy tính và máy tính bảng có nên thay thế hoàn toàn sách ở trường và đại học không.
Đánh giá công cụ Write and Improve|Viết bài đánh giá cho tạp chí người học tiếng Anh.|Mô tả chức năng chính và vì sao hữu ích hoặc không.|Nêu điều thích và khó khăn; kết thúc bằng khuyến nghị.
Buổi hòa nhạc đã đi|Viết thư cho người bạn nói tiếng Anh.|Giải thích lý do đến, người biểu diễn và diễn biến buổi hòa nhạc.'''.splitlines()

def build(source=SOURCE, target=TARGET):
    raw = Path(source).read_bytes()
    rows = list(csv.DictReader(raw.decode('utf-8-sig').splitlines(), delimiter='\t'))
    assert len(rows) == len(CURATION) == 50
    digest = hashlib.sha256(raw).hexdigest()
    items, changes = [], []
    modes = {4:('about',70,70),7:('about',100,100),25:('about',80,80),26:('about',50,50),27:('about',30,30),32:('minimum',25,25),36:('range',140,190),38:('minimum',25,25),39:('about',40,40)}
    for i,(r,c) in enumerate(zip(rows,CURATION)):
        prompt = strict_decode(re.sub(r'<U\+([0-9A-Fa-f]{4})>', lambda m:'\\u'+m[1], r['prompt']))
        prompt = prompt.replace('**','').replace('__','').replace('_','')
        assert not re.search(r'<U\+',prompt)
        title,*requirements=c.split('|')
        mode,lo,hi = modes.get(i,('metadata',int(r['min_words']),int(r['max_words'])))
        genre = {26:'A note',27:'A note',40:'A letter',49:'A letter'}.get(i,r['genre'])
        t=dict(id=r['question_id'],title=title,prompt=prompt,level=r['prompt_level'],genre=genre,topic=r['topic'],minWords=lo,maxWords=hi,wordMode=mode,requirements=requirements,sourceSha256=digest,sourcePromptSha256=hashlib.sha256(r['prompt'].encode()).hexdigest(),reviewStatus='automated-reviewed-not-expert')
        fields=[t['id'],title,prompt,t['level'],genre,t['topic'],str(lo),str(hi),mode,str(len(requirements)),*requirements,digest,t['sourcePromptSha256'],t['reviewStatus']]
        t['version']=hashlib.sha256(''.join(str(len(s.encode('utf-8')))+':'+s for s in fields).encode('utf-8')).hexdigest()
        items.append(t)
        if i in modes or genre!=r['genre']:
            changes.append(dict(id=t['id'],sourceGenre=r['genre'],displayGenre=genre,sourceMinWords=r['min_words'],sourceMaxWords=r['max_words'],displayMode=mode,displayMin=lo,displayMax=hi))
    assert len({t['id'] for t in items})==50
    target=Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dict(items=items,version=digest,sourceCount=50),ensure_ascii=False,indent=2),encoding='utf-8')
    report = dict(sourceSha256=digest, expectedSource=digest == EXPECTED_SOURCE_SHA256,
                  catalogueSha256=hashlib.sha256(target.read_bytes()).hexdigest(), items=len(items),
                  levels={level: sum(t['level'] == level for t in items) for level in ['Beginner', 'Intermediate', 'Advanced']})
    print(json.dumps(report, indent=2))
    if not report['expectedSource']:
        print('WARNING: this prompts file differs from the one LEWA used; task ids/versions may not match saved essays.')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build ai/writing/data/prompt-catalogue.v1.json from your own W&I 2024 copy')
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=TARGET)
    args = parser.parse_args()
    if not args.source.is_file():
        raise SystemExit(f'Prompts file not found: {args.source}. Get the Cambridge W&I 2024 corpus first (docs/WRITING_SETUP_FOR_AGENTS.md).')
    build(args.source, args.output)
