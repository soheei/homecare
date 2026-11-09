import subprocess,sys
s='C:/Users/WCL/.agents/skills/synced/250cfd12-f6bf-4b63-9171-3571bd35f81d_092b9b2f-d601-4b45-bb88-758b58e890da/pptx/scripts/add_slide.py'
steps=[['최종 데모용.pptx','slide8.xml','--after','slide8.xml','-o','.ppt-build/base1.pptx'],['.ppt-build/base1.pptx','slide8.xml','--after','slide3.xml','-o','.ppt-build/base2.pptx'],['.ppt-build/base2.pptx','slide8.xml','--after','slide19.xml','-o','.ppt-build/base-v2.pptx']]
for args in steps:
 r=subprocess.run([sys.executable,s,*args],capture_output=True,text=True,encoding='utf-8');print(r.stdout);print(r.stderr);r.check_returncode()
