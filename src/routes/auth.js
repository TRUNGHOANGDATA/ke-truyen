import bcrypt from 'bcryptjs';

export function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  if (req.path.startsWith('/api/') || req.path === '/img') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login');
}

export function mountAuth(app, { passwordHash }) {
  app.get('/login', (req, res) => {
    if (req.session?.authed) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', (req, res) => {
    const ok = passwordHash && bcrypt.compareSync(req.body.password || '', passwordHash);
    if (!ok) return res.status(401).render('login', { error: 'Sai mật khẩu' });
    req.session.authed = true;
    res.redirect('/');
  });

  app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

  app.post('/settings/password', (req, res) => {
    const { current, next } = req.body;
    if (!bcrypt.compareSync(current || '', passwordHash)) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    if (!next || next.length < 6) return res.status(400).json({ error: 'Mật khẩu mới quá ngắn' });
    const newHash = bcrypt.hashSync(next, 10);
    res.json({ ok: true, hash: newHash, note: 'Cập nhật PASSWORD_HASH trong .env rồi khởi động lại.' });
  });
}
