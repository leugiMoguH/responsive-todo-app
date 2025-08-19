const fs = require('fs');
const path = require('path');
const RATE_LIMIT_FILE = path.join(__dirname, 'rateLimitStore.json');
const MAX_REQUESTS_PER_IP = 5; // 5 por dia

function readRateLimit() {
  try {
    return JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf8'));
  } catch {
    return { usage: {} };
  }
}
function writeRateLimit(data) {
  fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(data, null, 2));
}
function resetDailyQuota() {
  const data = readRateLimit();
  const today = new Date().toISOString().slice(0, 10);
  if (data.lastReset !== today) {
    data.usage = {};
    data.lastReset = today;
    writeRateLimit(data);
  }
}
setInterval(resetDailyQuota, 1000 * 60 * 10); // 10min
resetDailyQuota();

function logRequest(ip, ia, promptType, lang) {
  const logLine = `${new Date().toISOString()} | IP: ${ip} | IA: ${ia} | Tipo: ${promptType} | Lang: ${lang}\n`;
  fs.appendFileSync(path.join(__dirname, 'api_usage.log'), logLine);
}

function checkAndUpdateQuota(ip) {
  const data = readRateLimit();
  if (!data.usage[ip]) data.usage[ip] = 0;
  if (data.usage[ip] >= MAX_REQUESTS_PER_IP) return false;
  data.usage[ip]++;
  writeRateLimit(data);
  return true;
}

function validateInput({ userInput, ia, lang, promptType }) {
  if (!userInput || typeof userInput !== 'string' || userInput.length < 5 || userInput.length > 1200) return false;
  if (!ia || !lang || !promptType) return false;
  return true;
}
// api.js - Backend seguro para Gemini (Node.js/Express)
// Instalar dependências: npm install express cors axios dotenv
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Segurança: só aceita requests do frontend
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['POST'],
  credentials: false
}));
app.use(express.json({ limit: '4mb' }));

// Gemini API KEY segura em variável de ambiente
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Falta a variável de ambiente GEMINI_API_KEY');
  process.exit(1);
}

// Endpoint seguro para geração/tradução de prompt
app.post('/api/generate-prompt', async (req, res) => {
  // --- Performance, segurança, validação e logging ---
  console.log('--- Novo pedido recebido ---');
  console.log('Body recebido:', req.body);
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  if (!checkAndUpdateQuota(ip)) {
    return res.status(429).json({ error: 'Limite diário atingido. Contacte-nos para mais acesso.' });
  }
  const { userInput, ia, lang, promptType, systemPrompt, langName } = req.body;
  if (!validateInput({ userInput, ia, lang, promptType })) {
    return res.status(400).json({ error: 'Input inválido.' });
  }
  logRequest(ip, ia, promptType, lang);

  try {
    // Multi-IA: só Gemini/Bard implementado, estrutura pronta para outras
    if (["Gemini", "Bard"].includes(ia)) {
      const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
      const body = {
        contents: [
          {
            parts: [ { text: `${systemPrompt}\n\nDescrição do utilizador: ${userInput}` } ]
          }
        ]
      };
      const geminiResp = await axios.post(
        geminiUrl,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': GEMINI_API_KEY
          },
          timeout: 15000
        }
      );
      let generated = geminiResp.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!generated) throw new Error('Sem resposta do Gemini.');
      // Tradução se necessário
      if (lang !== 'en') {
        const translatePrompt = `Traduz o seguinte texto para ${langName || lang}, mantendo o significado e o formato:\n\n${generated}`;
        const translateBody = {
          contents: [
            {
              parts: [ { text: translatePrompt } ]
            }
          ]
        };
        const translateResp = await axios.post(
          geminiUrl,
          translateBody,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': GEMINI_API_KEY
            },
            timeout: 15000
          }
        );
        generated = translateResp.data.candidates?.[0]?.content?.parts?.[0]?.text || generated;
      }
      console.log('Resposta enviada ao frontend:', generated);
      return res.json({ prompt: generated });
    }
    // Outras IAs: implementar integração conforme documentação de cada uma
    return res.status(501).json({ error: 'Integração com esta IA ainda não disponível.' });
  } catch (err) {
    console.error('Erro no /api/generate-prompt:', err);
    res.status(500).json({ error: 'Erro ao gerar prompt.' });
  }
});

// --- Inicializar servidor Express ---
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`Servidor backend iniciado em http://localhost:${PORT}`);
  console.log('========================================');
});
