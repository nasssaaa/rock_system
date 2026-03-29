module.exports = {
    apps: [{
        name: "rock_sys",
        // 使用 python -m uvicorn 的方式启动
        script: "python3.10",
        args: "-m uvicorn app.main:app --host 0.0.0.0 --port 8000",
        // 注意：在生产/PM2模式下，建议去掉 --reload 以提高稳定性
        env: {
            INFLUXDB_URL: "http://localhost:8086",
            INFLUXDB_TOKEN: "pT_kW58xyNG5hMnrDVLx4ECwpttVmCa6xFoP_7WKlD4_07OXdkUchnv3KTi9GMglyP5dhQAnOVp8jX8DONtshQ==",
            INFLUXDB_ORG: "rock_org",
            INFLUXDB_BUCKET_RAW: "ae_data",
            INFLUXDB_BUCKET_DOWN: "ae_data_downsampled"
        }
    }]
}