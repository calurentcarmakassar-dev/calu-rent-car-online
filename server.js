require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.resolve(process.env.DB_PATH || './data/rental.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET harus diatur dengan nilai acak minimal 32 karakter di production.');
}
const sessionSecret = process.env.SESSION_SECRET || 'development-only-secret-change-before-deploy-123456789';
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','employee')),
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('Mobil','Motor')),
    name TEXT NOT NULL, plate TEXT NOT NULL UNIQUE, rate INTEGER NOT NULL CHECK(rate >= 0),
    status TEXT NOT NULL DEFAULT 'Ready' CHECK(status IN ('Ready','Terpakai','Pulang','Servis')),
    notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rentals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
    id_number TEXT NOT NULL DEFAULT '', unit_id INTEGER NOT NULL REFERENCES units(id),
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, days INTEGER NOT NULL,
    rate INTEGER NOT NULL, total INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Terpakai' CHECK(status IN ('Terpakai','Pulang','Selesai','Dibatalkan')),
    notes TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES employees(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rental_id INTEGER NOT NULL REFERENCES rentals(id),
    amount INTEGER NOT NULL CHECK(amount > 0), method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '', received_by INTEGER REFERENCES employees(id),
    paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER REFERENCES employees(id),
    action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_rentals_unit_status ON rentals(unit_id,status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_rentals_dates ON rentals(start_date,end_date)');
  db.get('SELECT COUNT(*) AS n FROM employees', async (err, row) => {
    if (err) return console.error(err);
    if (!row.n) {
      const name = process.env.ADMIN_NAME || 'Administrator';
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      const hash = await bcrypt.hash(password, 12);
      db.run('INSERT INTO employees(name,username,password_hash,role) VALUES(?,?,?,?)',
        [name, username, hash, 'admin'], e => {
          if (e) console.error(e);
          else console.log(`Admin awal dibuat: username "${username}". Atur ADMIN_PASSWORD pada environment.`);
        });
    }
  });
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(DB_PATH), concurrentDB: true }),
  secret: sessionSecret,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi 15 menit kemudian.' } });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const get = (sql, params=[]) => new Promise((resolve,reject)=>db.get(sql,params,(e,r)=>e?reject(e):resolve(r)));
const all = (sql, params=[]) => new Promise((resolve,reject)=>db.all(sql,params,(e,r)=>e?reject(e):resolve(r)));
const run = (sql, params=[]) => new Promise((resolve,reject)=>db.run(sql,params,function(e){e?reject(e):resolve({id:this.lastID,changes:this.changes})}));
function log(req, action, details='') { db.run('INSERT INTO activity_log(employee_id,action,details) VALUES(?,?,?)',[req.session.user?.id || null,action,String(details).slice(0,500)]); }
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Silakan login terlebih dahulu.'}); next(); }
function admin(req,res,next){ if(req.session.user?.role!=='admin') return res.status(403).json({error:'Akses khusus admin.'}); next(); }
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')) && !Number.isNaN(new Date(s+'T00:00:00').getTime());}
function int(n){return Number.isSafeInteger(Number(n)) && Number(n)>=0;}
app.get('/api/health',(req,res)=>res.json({ok:true,app:'Calu Rent Car Online'}));
app.post('/api/login',loginLimiter,asyncRoute(async(req,res)=>{
  const {username,password}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string') return res.status(400).json({error:'Username dan kata sandi wajib diisi.'});
  const user=await get('SELECT * FROM employees WHERE username=? AND active=1',[username.trim()]);
  if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'Username atau kata sandi salah.'});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Gagal membuat sesi login.'});
    req.session.user={id:user.id,name:user.name,username:user.username,role:user.role};
    log(req,'Login berhasil',user.username);
    res.json({user:req.session.user});
  });
}));
app.post('/api/logout',auth,(req,res)=>{const name=req.session.user.username;req.session.destroy(()=>res.json({ok:true,message:`Sesi ${name} berakhir.`}));});
app.get('/api/me',auth,(req,res)=>res.json({user:req.session.user}));
app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
  const units=await all('SELECT * FROM units ORDER BY type,name');
  const totals=await get(`SELECT COALESCE(SUM(total),0) total,COALESCE(SUM(paid),0) paid,
    SUM(CASE WHEN paid<total AND status NOT IN ('Dibatalkan') THEN 1 ELSE 0 END) unpaid_count
    FROM rentals WHERE status!='Dibatalkan'`);
  const rentals=await all(`SELECT r.*,u.name AS unit_name,u.plate,u.type AS unit_type,
    MAX(0,r.total-r.paid) AS due FROM rentals r JOIN units u ON u.id=r.unit_id
    WHERE r.status!='Dibatalkan' ORDER BY r.id DESC LIMIT 8`);
  const activity=await all(`SELECT a.*,e.name AS employee_name FROM activity_log a LEFT JOIN employees e ON e.id=a.employee_id ORDER BY a.id DESC LIMIT 8`);
  res.json({units,totals,rentals,activity});
}));
app.get('/api/units',auth,asyncRoute(async(req,res)=>res.json(await all('SELECT * FROM units ORDER BY type,name'))));
app.post('/api/units',auth,admin,asyncRoute(async(req,res)=>{
  const {type,name,plate,rate,status='Ready',notes=''}=req.body||{};
  if(!['Mobil','Motor'].includes(type)||!String(name||'').trim()||!String(plate||'').trim()||!int(rate)||!['Ready','Terpakai','Pulang','Servis'].includes(status))return res.status(400).json({error:'Data unit belum valid.'});
  const result=await run('INSERT INTO units(type,name,plate,rate,status,notes) VALUES(?,?,?,?,?,?)',[type,name.trim(),plate.trim().toUpperCase(),Number(rate),status,String(notes||'').trim()]);
  log(req,'Tambah unit',`${type} ${name} / ${plate}`);res.status(201).json(await get('SELECT * FROM units WHERE id=?',[result.id]));
}));
app.put('/api/units/:id',auth,admin,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),{type,name,plate,rate,status,notes=''}=req.body||{};
  if(!['Mobil','Motor'].includes(type)||!String(name||'').trim()||!String(plate||'').trim()||!int(rate)||!['Ready','Terpakai','Pulang','Servis'].includes(status))return res.status(400).json({error:'Data unit belum valid.'});
  const exists=await get('SELECT id FROM units WHERE id=?',[id]);if(!exists)return res.status(404).json({error:'Unit tidak ditemukan.'});
  await run('UPDATE units SET type=?,name=?,plate=?,rate=?,status=?,notes=? WHERE id=?',[type,name.trim(),plate.trim().toUpperCase(),Number(rate),status,String(notes||'').trim(),id]);
  log(req,'Ubah unit',`${type} ${name} / ${plate}`);res.json(await get('SELECT * FROM units WHERE id=?',[id]));
}));
app.delete('/api/units/:id',auth,admin,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id), used=await get('SELECT COUNT(*) n FROM rentals WHERE unit_id=?',[id]);
  if(used.n)return res.status(409).json({error:'Unit memiliki riwayat transaksi dan tidak dapat dihapus. Ubah status menjadi Servis bila tidak digunakan.'});
  await run('DELETE FROM units WHERE id=?',[id]);log(req,'Hapus unit',String(id));res.json({ok:true});
}));
app.get('/api/rentals',auth,asyncRoute(async(req,res)=>res.json(await all(`SELECT r.*,u.name AS unit_name,u.plate,u.type AS unit_type,MAX(0,r.total-r.paid) due
  FROM rentals r JOIN units u ON u.id=r.unit_id ORDER BY r.id DESC`))));
app.post('/api/rentals',auth,asyncRoute(async(req,res)=>{
  const {customer,phone='',id_number='',unit_id,start_date,end_date,rate,paid=0,notes=''}=req.body||{};
  if(!String(customer||'').trim()||!validDate(start_date)||!validDate(end_date)||end_date<=start_date||!int(rate)||!int(paid))return res.status(400).json({error:'Data transaksi atau tanggal belum valid.'});
  const u=await get('SELECT * FROM units WHERE id=?',[Number(unit_id)]);
  if(!u||u.status!=='Ready')return res.status(409).json({error:'Unit tidak tersedia. Pilih unit dengan status Ready.'});
  const days=Math.round((new Date(end_date+'T00:00:00')-new Date(start_date+'T00:00:00'))/86400000);
  const total=days*Number(rate);if(paid>total)return res.status(400).json({error:'Pembayaran awal melebihi total biaya.'});
  const overlap=await get(`SELECT COUNT(*) n FROM rentals WHERE unit_id=? AND status IN ('Terpakai','Pulang') AND start_date<? AND end_date>?`,[u.id,end_date,start_date]);
  if(overlap.n)return res.status(409).json({error:'Jadwal unit bertabrakan dengan transaksi lain.'});
  const result=await run(`INSERT INTO rentals(customer,phone,id_number,unit_id,start_date,end_date,days,rate,total,paid,status,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,'Terpakai',?,?)`,[customer.trim(),String(phone),String(id_number),u.id,start_date,end_date,days,Number(rate),total,Number(paid),String(notes),req.session.user.id]);
  await run('UPDATE units SET status=? WHERE id=?',['Terpakai',u.id]);
  if(Number(paid)>0)await run('INSERT INTO payments(rental_id,amount,method,received_by) VALUES(?,?,?,?)',[result.id,Number(paid),'Pembayaran awal',req.session.user.id]);
  log(req,'Rental baru',`${customer} / ${u.name} / ${total}`);res.status(201).json(await get('SELECT * FROM rentals WHERE id=?',[result.id]));
}));
app.post('/api/rentals/:id/return',auth,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),r=await get('SELECT * FROM rentals WHERE id=?',[id]);
  if(!r)return res.status(404).json({error:'Transaksi tidak ditemukan.'});
  if(!['Terpakai','Pulang'].includes(r.status))return res.status(409).json({error:'Transaksi sudah ditutup atau dibatalkan.'});
  await run("UPDATE rentals SET status='Selesai' WHERE id=?",[id]);
  const active=await get("SELECT COUNT(*) n FROM rentals WHERE unit_id=? AND status='Terpakai'",[r.unit_id]);
  await run('UPDATE units SET status=? WHERE id=?',[active.n?'Terpakai':'Ready',r.unit_id]);
  log(req,'Pengembalian selesai',`Transaksi #${id}`);res.json({ok:true});
}));
app.post('/api/rentals/:id/payment',auth,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),{amount,method='Tunai',reference=''}=req.body||{};
  if(!int(amount)||Number(amount)<=0||!['Tunai','Transfer bank','QRIS','Kartu debit','Lainnya'].includes(method))return res.status(400).json({error:'Nominal atau metode pembayaran tidak valid.'});
  const r=await get('SELECT * FROM rentals WHERE id=?',[id]);if(!r)return res.status(404).json({error:'Transaksi tidak ditemukan.'});
  if(r.status==='Dibatalkan')return res.status(409).json({error:'Transaksi dibatalkan.'});
  if(Number(amount)>r.total-r.paid)return res.status(400).json({error:'Pembayaran melebihi sisa tagihan.'});
  await run('INSERT INTO payments(rental_id,amount,method,reference,received_by) VALUES(?,?,?,?,?)',[id,Number(amount),method,String(reference),req.session.user.id]);
  await run('UPDATE rentals SET paid=paid+? WHERE id=?',[Number(amount),id]);
  log(req,'Pembayaran diterima',`Transaksi #${id} / ${amount} / ${method}`);
  res.json(await get('SELECT id,total,paid,total-paid AS due FROM rentals WHERE id=?',[id]));
}));
app.get('/api/payments',auth,asyncRoute(async(req,res)=>res.json(await all(`SELECT p.*,r.customer,r.total AS rental_total,u.name AS unit_name,u.plate,e.name AS received_by_name
  FROM payments p JOIN rentals r ON r.id=p.rental_id JOIN units u ON u.id=r.unit_id LEFT JOIN employees e ON e.id=p.received_by ORDER BY p.id DESC`))));
app.get('/api/employees',auth,admin,asyncRoute(async(req,res)=>res.json(await all('SELECT id,name,username,role,active,created_at FROM employees ORDER BY name'))));
app.post('/api/employees',auth,admin,asyncRoute(async(req,res)=>{
  const {name,username,password,role='employee'}=req.body||{};
  if(!String(name||'').trim()||!String(username||'').trim()||typeof password!=='string'||password.length<10||!['admin','employee'].includes(role))return res.status(400).json({error:'Isi nama, username, peran, dan kata sandi minimal 10 karakter.'});
  const hash=await bcrypt.hash(password,12);
  const result=await run('INSERT INTO employees(name,username,password_hash,role) VALUES(?,?,?,?)',[name.trim(),username.trim(),hash,role]);
  log(req,'Tambah akun karyawan',username);res.status(201).json(await get('SELECT id,name,username,role,active FROM employees WHERE id=?',[result.id]));
}));
app.patch('/api/employees/:id',auth,admin,asyncRoute(async(req,res)=>{
  const id=Number(req.params.id),active=Boolean(req.body?.active);
  if(id===req.session.user.id&&!active)return res.status(400).json({error:'Admin tidak dapat menonaktifkan akun sendiri.'});
  const target=await get('SELECT id FROM employees WHERE id=?',[id]);if(!target)return res.status(404).json({error:'Akun tidak ditemukan.'});
  await run('UPDATE employees SET active=? WHERE id=?',[active?1:0,id]);log(req,'Ubah status akun',`${id}: ${active?'aktif':'nonaktif'}`);res.json({ok:true});
}));
app.get('/api/reports/summary',auth,asyncRoute(async(req,res)=>{
  const {from,to}=req.query;
  if(!validDate(from)||!validDate(to)||to<from)return res.status(400).json({error:'Rentang tanggal tidak valid.'});
  const summary=await get(`SELECT COUNT(*) transactions,COALESCE(SUM(total),0) billed,COALESCE(SUM(paid),0) collected,
    COALESCE(SUM(total-paid),0) receivable FROM rentals WHERE status!='Dibatalkan' AND substr(created_at,1,10) BETWEEN ? AND ?`,[from,to]);
  const byMethod=await all(`SELECT method,SUM(amount) amount,COUNT(*) count FROM payments WHERE substr(paid_at,1,10) BETWEEN ? AND ? GROUP BY method`,[from,to]);
  res.json({summary,byMethod});
}));
app.use('/api', (req,res)=>res.status(404).json({error:'Endpoint tidak ditemukan.'}));
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{
  if(err && err.code==='SQLITE_CONSTRAINT')return res.status(409).json({error:'Data bentrok atau melanggar aturan database. Periksa nomor polisi dan data terkait.'});
  console.error(err);res.status(500).json({error:'Terjadi kesalahan pada server.'});
});
app.listen(PORT,()=>console.log(`Calu Rent Car berjalan di http://localhost:${PORT}`));
