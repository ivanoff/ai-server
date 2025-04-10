const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'system', content: 'Ты полезный ассистент.' },
      { role: 'user', content: 'Расскажи о TypeScript' }
    ],
    max_tokens: 500,
    temperature: 0.7
  })
});

const data = await response.json();
console.log(JSON.stringify(data, null, '  '));
