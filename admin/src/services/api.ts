import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

// Request interceptor to add token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle errors (like 401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('adminToken');
      window.location.href = '/login';
    }
    if (
      error.response?.status === 403
      && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED'
      && window.location.pathname !== '/change-password'
    ) {
      window.location.href = '/change-password';
    }
    return Promise.reject(error);
  }
);

export default api;
