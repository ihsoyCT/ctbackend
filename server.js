const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['https://ihsoyCT.github.io', 'https://ihsoy.com'],
  methods: ['GET'],
}));

app.use('/api/stats',  require('./routes/stats'));
app.use('/api/search', require('./routes/search'));
app.use('/api',        require('./routes/tracking'));

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`ctarchive-analytics listening on http://localhost:${PORT}`);
});
