import json,sys
a=json.load(open('config/agency_urls.json'))
kind=sys.argv[1]
for l in sys.stdin:
    l=l.strip()
    if '|' in l:
        n,u=l.split('|',1); a[kind][n.strip()]=u.strip()
json.dump(a,open('config/agency_urls.json','w'),indent=2,ensure_ascii=False); open('config/agency_urls.json','a').write('\n')
print({k:len(v) for k,v in a.items() if k!='_note'})
