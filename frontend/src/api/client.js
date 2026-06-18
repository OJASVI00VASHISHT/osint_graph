import axios from 'axios';

// Use empty baseURL so all /api requests go through Vite's dev proxy
// (vite.config.js proxies /api → http://localhost:8000)
// This avoids CORS issues entirely during development.
const api = axios.create({ baseURL: '' });

export const startInvestigation = (query, queryType) =>
  api.post('/api/investigate', { query, query_type: queryType });

export const getInvestigation = (id) =>
  api.get(`/api/investigation/${id}`);

export const getGraph = (id) =>
  api.get(`/api/graph/${id}`);

export const getEntities = () =>
  api.get('/api/entities');

export const healthCheck = () =>
  api.get('/api/health');

export const updatePerson = (id, data) =>
  api.put(`/api/person/${id}`, data);

export const getPeople = () =>
  api.get('/api/people');

export const uploadCDR = (id, cdrText) =>
  api.post(`/api/person/${id}/cdr`, { cdr_text: cdrText });

export const uploadIPDR = (id, ipdrText) =>
  api.post(`/api/person/${id}/ipdr`, { ipdr_text: ipdrText });

export const getPersonAnalysis = (id) =>
  api.get(`/api/person/${id}/analysis`);

export const createPerson = (investigationId, data) =>
  api.post(`/api/investigation/${investigationId}/person`, data);

export const createRelationship = (data) =>
  api.post('/api/relationship', data);

export const deleteNode = (id) =>
  api.delete(`/api/node/${id}`);

export const clearAllData = () =>
  api.delete('/api/clear');

export default api;
