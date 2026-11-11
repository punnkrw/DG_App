# DG Trip Report

@CONTEXT.md

แผนงานอยู่ที่ `MILESTONES.md` และเอกสารออกแบบฉบับเต็มอยู่ที่ `DG-Trip-Report-Design.md` ถ้าไฟล์เหล่านี้ไม่มี (เช่น clone มาใหม่) ให้ขอจากเจ้าของโปรเจกต์ เพราะไม่ได้อยู่ใน repo

## กฎของ repo

- repo นี้เป็น public ห้าม commit secret, ข้อมูลลูกค้า, ทะเบียนรถ หรือข้อมูลคนขับ
- secret เก็บใน Script Properties เท่านั้น
- `steps.json` เป็นแหล่งเดียวของนิยามขั้นและช่องรูป
- `web/` เป็น HTML + JS ล้วน ไม่ต้อง build และ deploy ขึ้น GitHub Pages เมื่อ push เข้า `main`
- `gas/` push ขึ้น Apps Script ด้วย `clasp`
- ตรวจสิทธิ์และกฎทุกข้อที่ backend เสมอ ห้ามเชื่อค่าจากหน้าเว็บ
- ไปต่อ milestone ถัดไปเมื่อผ่านเกณฑ์ใน `MILESTONES.md` แล้วเท่านั้น
- ถ้ามีคำถาม ให้ถามเป็นตัวเลือก
