// Gmail's modify scope permits sending, but e-zer0 must never send mail.
export function assertEmailRequestAllowed(url: string): void {
    const path = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
    if (/\/(send|sendMail|reply|replyAll|forward)$/i.test(path)) {
        throw new Error('Sending email is disabled in e-zer0. Create a draft instead.');
    }
}
