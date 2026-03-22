import { Network } from '@capacitor/network'

let _isOnline = navigator.onLine

Network.getStatus().then(status => { _isOnline = status.connected })
Network.addListener('networkStatusChange', status => { _isOnline = status.connected })

export function isOnline() { return _isOnline }
