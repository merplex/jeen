//
//  ViewController.swift
//  App
//
//  Created by Xiang Chuan on 20/3/2569 BE.
//

import Capacitor

  class ViewController: CAPBridgeViewController {
      override open func capacitorDidLoad() {
          bridge?.registerPluginInstance(IAPPlugin())
      }
  }
