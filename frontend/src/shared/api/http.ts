import axios from 'axios'
import { formatHttpError } from '../lib/errorMessage'

export const http = axios.create({
  baseURL: '/api',
  timeout: 10000
})

export async function getStreamBody(response: Response) {
  if (!response.ok)
    throw new Error(formatHttpError(response.status, response.statusText, await response.text()))
  if (!response.body) throw new Error(`HTTP ${response.status}：响应缺少流式正文。`)
  return response.body
}
