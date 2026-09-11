import axios from 'axios';
import https from 'https';

const API_URL = process.env.WHATCHIMP_API_URL || 'https://api.whatchimp.com';

/**
 * WhatChimp API Client
 * Handles communication with the WhatsApp Marketing Platform
 */
export const whatchimp = {
  async sendMessage(phone, message) {
    const API_KEY = process.env.WHATCHIMP_API_KEY;
    if (!API_KEY) {
      return { success: false, error: 'Missing WHATCHIMP_API_KEY in environment' };
    }

    try {
      const response = await axios.post(`${API_URL}/send`, {
        phone: phone,
        message: message,
      }, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MiniMe-Omnichannel-Gateway/1.0',
        },
        httpsAgent: new https.Agent({ 
          rejectUnauthorized: true, 
          minVersion: 'TLSv1.2' 
        }),
      });

      return { success: true, data: response.data };
    } catch (e) {
      console.error('[WhatChimp] sendMessage failed:', e.response?.data || e.message);
      return { success: false, error: e.response?.data || e.message };
    }
  },

  async sendTemplate(phone, templateName, components = []) {
    const API_KEY = process.env.WHATCHIMP_API_KEY;
    if (!API_KEY) {
      return { success: false, error: 'Missing WHATCHIMP_API_KEY in environment' };
    }

    try {
      const response = await axios.post(`${API_URL}/template`, {
        phone: phone,
        template: templateName,
        components: components,
      }, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MiniMe-Omnichannel-Gateway/1.0',
        },
        httpsAgent: new https.Agent({ 
          rejectUnauthorized: true, 
          minVersion: 'TLSv1.2' 
        }),
      });

      return { success: true, data: response.data };
    } catch (e) {
      console.error('[WhatChimp] sendTemplate failed:', e.response?.data || e.message);
      return { success: false, error: e.response?.data || e.message };
    }
  },
};