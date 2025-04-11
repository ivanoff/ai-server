const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me a little bit about TypeScript' }
    ],
    max_tokens: 500,
    temperature: 0.7
  })
});

const data = await response.json();
console.log(JSON.stringify(data, null, '  '));
