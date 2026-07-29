/**
 * main.ts — application entry point
 */

import './style.css';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app element not found');

new App(root);
