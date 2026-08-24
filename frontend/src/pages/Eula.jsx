export default function Eula() {
  return (
    <div className="max-w-lg mx-auto min-h-screen bg-white px-6 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">End User License Agreement (EULA)</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated: August 24, 2026</p>

      <section className="mb-6">
        <p>
          This End User License Agreement ("EULA") is an agreement between you and C-T Scan
          ("we", "our", or "us") governing your use of the C-T Scan mobile application on your
          iOS or Android device.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">License Grant</h2>
        <p className="text-sm">
          We grant you a limited, non-exclusive, non-transferable license to install and use the
          app on devices you own or control, subject to the applicable App Store / Google Play
          Terms of Service.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Restrictions</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>No copying, modifying, or distributing the app without permission</li>
          <li>No reverse engineering or decompiling</li>
          <li>No sharing or reselling Premium accounts or subscription access</li>
          <li>No use of the app for unlawful purposes</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Account & Sign-In</h2>
        <p className="text-sm">
          You may create an account with an email, phone number, or LINE ID. If you choose to
          sign in with Google Sign-In or Apple Sign-In (where offered), we receive your email and
          basic name from that provider, as authorized by you, solely to create and link your
          account.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Subscriptions & Payment</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Payment is processed through Google Play or the Apple App Store, depending on your device</li>
          <li>Subscriptions renew automatically unless cancelled before the renewal date</li>
          <li>Manage or cancel auto-renewal through your Google Play or Apple ID account settings</li>
          <li>Refunds are handled per Google Play's and Apple's respective refund policies — we do not process refunds directly</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Intellectual Property</h2>
        <p className="text-sm">
          The app, including its code, design, dictionary content, and learning materials, is our
          property and is protected by copyright law.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Service Availability</h2>
        <p className="text-sm">
          We aim to provide a stable service but do not guarantee uninterrupted availability. We
          reserve the right to modify, improve, or discontinue parts of the service without prior
          notice.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Termination</h2>
        <p className="text-sm">
          This license terminates immediately if you violate any term of this agreement. Upon
          termination, you must delete the app from all your devices.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Apple and Google</h2>
        <p className="text-sm">
          The app is distributed via the Apple App Store and Google Play. Apple and Google are not
          parties to this EULA and bear no responsibility for the app or its content, though your
          use is also subject to their respective Terms of Service.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Governing Law</h2>
        <p className="text-sm">This EULA is governed by the laws of Thailand. Any disputes fall under Thai court jurisdiction.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Contact Us</h2>
        <p className="text-sm">
          Questions about this EULA? Contact us at:{' '}
          <a href="mailto:merplex@gmail.com" className="text-blue-600 underline">
            merplex@gmail.com
          </a>
        </p>
      </section>
    </div>
  )
}
