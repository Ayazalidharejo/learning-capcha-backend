import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE || '';

export async function call(path, opts = {}) {
  const url = path.startsWith('http') ? path : (BASE ? BASE + path : path);
  
  try {
    const config = {
      url,
      method: opts.method || 'GET',
      data: opts.data,
      headers: opts.headers || {}
    };
    
    const res = await axios(config);
    return res.data;
  } catch (e) {
    if (e.response) {
      return { error: e.response.data?.error || JSON.stringify(e.response.data) };
    }
    return { error: String(e) };
  }
}

export default { call };