import { createRouter, createWebHistory } from 'vue-router';

const ChatView = () => import('../views/ChatView.vue');
const CollectiveView = () => import('../views/CollectiveView.vue');
const SessionsView = () => import('../views/SessionsView.vue');
const ProcessesView = () => import('../views/ProcessesView.vue');
const FilesView = () => import('../views/FilesView.vue');
const ConfigView = () => import('../views/ConfigView.vue');

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    { path: '/chat', component: ChatView },
    { path: '/chat/:conversationId', component: ChatView },
    { path: '/collective', component: CollectiveView },
    { path: '/sessions', component: SessionsView },
    { path: '/processes', component: ProcessesView },
    { path: '/files', component: FilesView },
    { path: '/files/:path(.*)', component: FilesView },
    { path: '/config', component: ConfigView },
  ],
});
